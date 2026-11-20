<?php
declare(strict_types=1);

$configPath = dirname(__DIR__) . '/config.php';
if (!is_file($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Backend configuration is missing. Copy config.example.php to config.php and configure MySQL.']);
    exit;
}

$config = require $configPath;
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(array $body, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function database(array $config): PDO
{
    static $connection;
    if ($connection instanceof PDO) return $connection;

    $db = $config['database'];
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=%s',
        $db['host'],
        $db['name'],
        $db['charset'] ?? 'utf8mb4'
    );
    $connection = new PDO($dsn, $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $connection;
}

function request_data(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) respond(['error' => 'Request body must be a JSON object.'], 400);
    return $data;
}

function consume_auth_email_rate_limit(PDO $pdo, string $email, string $purpose): bool
{
    if (!in_array($purpose, ['signup', 'password_reset', 'verify_email'], true) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Invalid account email rate-limit request.');
    }
    $emailKey = 'email:' . $purpose . ':' . hash('sha256', strtolower(trim($email)));
    $ipKey = 'ip:' . hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $upsert = $pdo->prepare(
        'INSERT INTO auth_email_rate_limits (rate_key, window_started_at, request_count)
         VALUES (?, UTC_TIMESTAMP(3), 1)
         ON DUPLICATE KEY UPDATE
           request_count = IF(window_started_at <= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, 1, request_count + 1),
           window_started_at = IF(window_started_at <= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR, UTC_TIMESTAMP(3), window_started_at),
           updated_at = UTC_TIMESTAMP(3)'
    );
    $upsert->execute([$emailKey]);
    $upsert->execute([$ipKey]);
    $counts = $pdo->prepare(
        'SELECT rate_key, request_count FROM auth_email_rate_limits WHERE rate_key IN (?, ?)'
    );
    $counts->execute([$emailKey, $ipKey]);
    $limits = [];
    foreach ($counts->fetchAll() as $row) $limits[$row['rate_key']] = (int)$row['request_count'];
    $pdo->exec('DELETE FROM auth_email_rate_limits WHERE updated_at < UTC_TIMESTAMP(3) - INTERVAL 2 DAY ORDER BY updated_at LIMIT 100');
    return ($limits[$emailKey] ?? 0) <= 3 && ($limits[$ipKey] ?? 0) <= 20;
}

function uuid_v4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
}

function user_by_id(PDO $pdo, string $userId): ?array
{
    $statement = $pdo->prepare(
        'SELECT u.id, u.email, u.role,
                EXISTS(SELECT 1 FROM admin_mfa_factors f WHERE f.user_id = u.id AND f.verified_at IS NOT NULL) AS mfa_required
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1'
    );
    $statement->execute([$userId]);
    $user = $statement->fetch();
    return $user ? [
        'id' => $user['id'],
        'email' => $user['email'],
        'app_metadata' => [
            'role' => $user['role'],
            'mfa_required' => $user['role'] === 'admin',
        ],
    ] : null;
}

function request_user(PDO $pdo, array $config): ?array
{
    $cookieName = $config['app']['session_cookie'] ?? 'mrhustler_session';
    $token = $_COOKIE[$cookieName] ?? '';
    if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{40,100}$/', $token)) return null;

    $statement = $pdo->prepare(
        'SELECT u.id, u.email, u.role, s.mfa_verified_at,
                EXISTS(SELECT 1 FROM admin_mfa_factors f WHERE f.user_id = u.id AND f.verified_at IS NOT NULL) AS mfa_enabled
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         JOIN profiles p ON p.user_id = u.id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3)
           AND (u.email_verified_at IS NOT NULL OR NOT EXISTS (
             SELECT 1 FROM email_smtp_settings es WHERE es.singleton = 1 AND es.enabled = 1
           ))
           AND u.account_status = \'active\' AND p.account_status = \'active\'
         LIMIT 1'
    );
    $statement->execute([hash('sha256', $token)]);
    $user = $statement->fetch();
    return $user ? [
        'id' => $user['id'],
        'email' => $user['email'],
        'app_metadata' => [
            'role' => $user['role'],
            'mfa_required' => $user['role'] === 'admin',
            'mfa_verified' => $user['role'] !== 'admin' || $user['mfa_verified_at'] !== null,
            'mfa_enabled' => (bool)$user['mfa_enabled'],
        ],
    ] : null;
}

function issue_session(PDO $pdo, array $config, string $userId, bool $requiresMfa = false): void
{
    $token = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    $lifetime = max(300, (int)($config['app']['session_lifetime_seconds'] ?? 2592000));
    $pdo->prepare(
        'INSERT INTO auth_sessions (token_hash, user_id, expires_at, mfa_verified_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), ?)'
    )->execute([hash('sha256', $token), $userId, $lifetime, $requiresMfa ? null : gmdate('Y-m-d H:i:s')]);

    $baseUrl = (string)($config['app']['base_url'] ?? '');
    $secure = str_starts_with(strtolower($baseUrl), 'https://');
    setcookie((string)($config['app']['session_cookie'] ?? 'mrhustler_session'), $token, [
        'expires' => time() + $lifetime,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function require_admin(PDO $pdo, array $config, bool $requireMfa = true): array
{
    $user = request_user($pdo, $config);
    if (!$user || ($user['app_metadata']['role'] ?? '') !== 'admin') respond(['error' => 'Administrator access is required.'], 403);
    if ($requireMfa && empty($user['app_metadata']['mfa_verified'])) respond(['error' => 'Complete administrator verification first.'], 403);
    return $user;
}

function application_key(array $config): string
{
    $secret = (string)($config['app']['secret_key'] ?? '');
    if (strlen($secret) < 32 || str_contains($secret, 'replace-with')) {
        throw new RuntimeException('Configure a private application secret key before using protected features.');
    }
    return hash('sha256', $secret, true);
}

function encrypt_secret(array $config, string $plaintext): string
{
    $key = application_key($config);
    $nonce = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag);
    if ($ciphertext === false) throw new RuntimeException('Could not protect the authenticator secret.');
    return base64_encode($nonce . $tag . $ciphertext);
}

function decrypt_secret(array $config, string $encoded): string
{
    $data = base64_decode($encoded, true);
    if ($data === false || strlen($data) < 29) throw new RuntimeException('Stored authenticator secret is invalid.');
    $plaintext = openssl_decrypt(substr($data, 28), 'aes-256-gcm', application_key($config), OPENSSL_RAW_DATA, substr($data, 0, 12), substr($data, 12, 16));
    if ($plaintext === false) throw new RuntimeException('Could not decrypt the authenticator secret.');
    return $plaintext;
}

function base32_encode(string $data): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split($data) as $byte) $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
    $encoded = '';
    foreach (str_split($bits, 5) as $chunk) {
        if (strlen($chunk) < 5) $chunk = str_pad($chunk, 5, '0', STR_PAD_RIGHT);
        $encoded .= $alphabet[bindec($chunk)];
    }
    return $encoded;
}

function base32_decode(string $encoded): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    foreach (str_split(rtrim(strtoupper($encoded), '=')) as $character) {
        $value = strpos($alphabet, $character);
        if ($value === false) throw new RuntimeException('Authenticator secret is invalid.');
        $bits .= str_pad(decbin($value), 5, '0', STR_PAD_LEFT);
    }
    $data = '';
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $data .= chr(bindec($byte));
    return $data;
}

function verify_totp(string $secret, string $code): bool
{
    if (!preg_match('/^\d{6}$/', $code)) return false;
    $key = base32_decode($secret);
    $counter = intdiv(time(), 30);
    for ($offset = -1; $offset <= 1; $offset++) {
        $step = $counter + $offset;
        $message = pack('N2', intdiv($step, 4294967296), $step % 4294967296);
        $hash = hash_hmac('sha1', $message, $key, true);
        $position = ord($hash[19]) & 0x0f;
        $value = ((ord($hash[$position]) & 0x7f) << 24)
            | ((ord($hash[$position + 1]) & 0xff) << 16)
            | ((ord($hash[$position + 2]) & 0xff) << 8)
            | (ord($hash[$position + 3]) & 0xff);
        if (hash_equals(str_pad((string)($value % 1000000), 6, '0', STR_PAD_LEFT), $code)) return true;
    }
    return false;
}

function smtp_expect($socket, array $expectedCodes): string
{
    $response = '';
    do {
        $line = fgets($socket, 1024);
        if ($line === false) throw new RuntimeException('SMTP server closed the connection.');
        $response .= $line;
    } while (isset($line[3]) && $line[3] === '-');

    $code = (int)substr($response, 0, 3);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException('SMTP server rejected a mail operation: ' . trim($response));
    }
    return $response;
}

function smtp_command($socket, string $command, array $expectedCodes): string
{
    if (fwrite($socket, $command . "\r\n") === false) throw new RuntimeException('Could not write to the SMTP server.');
    return smtp_expect($socket, $expectedCodes);
}

function send_smtp_email(array $config, string $recipient, string $subject, string $body, ?array $smtpOverride = null): void
{
    $smtp = $smtpOverride ?? ($config['smtp'] ?? []);
    foreach (['host', 'from_email'] as $required) {
        if (!isset($smtp[$required]) || $smtp[$required] === '' || $smtp[$required] === 'change-this') {
            throw new RuntimeException('SMTP is not fully configured.');
        }
    }
    if (!empty($smtp['username']) && (empty($smtp['password']) || $smtp['password'] === 'change-this')) {
        throw new RuntimeException('SMTP authentication password is not configured.');
    }
    $host = (string)$smtp['host'];
    $port = (int)($smtp['port'] ?? 587);
    $encryption = (string)($smtp['encryption'] ?? 'starttls');
    if (!in_array($encryption, ['ssl', 'starttls', 'none'], true) || $port < 1 || $port > 65535) {
        throw new RuntimeException('SMTP configuration is invalid.');
    }
    $transport = $encryption === 'ssl' ? 'ssl://' : 'tcp://';
    $socket = stream_socket_client(
        $transport . $host . ':' . $port,
        $errorCode,
        $errorMessage,
        15,
        STREAM_CLIENT_CONNECT
    );
    if ($socket === false) throw new RuntimeException('SMTP connection failed: ' . $errorMessage, $errorCode);
    stream_set_timeout($socket, 15);

    try {
        smtp_expect($socket, [220]);
        $helo = smtp_command($socket, 'EHLO ' . (parse_url((string)($config['app']['base_url'] ?? ''), PHP_URL_HOST) ?: 'localhost'), [250]);
        if ($encryption === 'starttls') {
            smtp_command($socket, 'STARTTLS', [220]);
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('Could not establish SMTP TLS encryption.');
            }
            $helo = smtp_command($socket, 'EHLO localhost', [250]);
        }
        if (!empty($smtp['username'])) {
            if (stripos($helo, 'AUTH') === false) throw new RuntimeException('SMTP server does not advertise authentication.');
            smtp_command($socket, 'AUTH LOGIN', [334]);
            smtp_command($socket, base64_encode((string)$smtp['username']), [334]);
            smtp_command($socket, base64_encode((string)$smtp['password']), [235]);
        }
        smtp_command($socket, 'MAIL FROM:<' . $smtp['from_email'] . '>', [250]);
        smtp_command($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
        smtp_command($socket, 'DATA', [354]);

        $fromName = addcslashes((string)($smtp['from_name'] ?? 'MrHustler'), '"\\');
        $message = 'From: "' . $fromName . '" <' . $smtp['from_email'] . ">\r\n"
            . 'To: <' . $recipient . ">\r\n"
            . 'Subject: =?UTF-8?B?' . base64_encode($subject) . "?=\r\n"
            . "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: 8bit\r\n\r\n"
            . preg_replace('/(?m)^\./', '..', str_replace(["\r\n", "\r"], "\n", $body));
        $message = str_replace("\n", "\r\n", $message);
        if (fwrite($socket, $message . "\r\n.\r\n") === false) throw new RuntimeException('Could not send the email body.');
        smtp_expect($socket, [250]);
        smtp_command($socket, 'QUIT', [221]);
    } finally {
        fclose($socket);
    }
}

function create_action_token(PDO $pdo, string $userId, string $purpose): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(36)), '+/', '-_'), '=');
    $pdo->prepare(
        'INSERT INTO auth_action_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))'
    )->execute([hash('sha256', $token), $userId, $purpose, $purpose === 'verify_email' ? 86400 : 3600]);
    return $token;
}

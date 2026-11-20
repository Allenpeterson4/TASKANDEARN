<?php
declare(strict_types=1);

function safe_email_error(Throwable $error): string
{
    return substr($error->getMessage(), 0, 500);
}

function email_smtp_settings(PDO $pdo): ?array
{
    $statement = $pdo->query('SELECT * FROM email_smtp_settings WHERE singleton = 1 LIMIT 1');
    $settings = $statement->fetch();
    return $settings ?: null;
}

function email_delivery_enabled(PDO $pdo): bool
{
    $settings = email_smtp_settings($pdo);
    return $settings !== null && (bool)$settings['enabled'];
}

function email_smtp_database_settings_present(?array $settings): bool
{
    return $settings !== null
        && (trim((string)$settings['host']) !== ''
            || trim((string)$settings['from_email']) !== ''
            || !empty($settings['password_ciphertext']));
}

function email_smtp_database_settings_configured(?array $settings): bool
{
    return $settings !== null
        && trim((string)$settings['host']) !== ''
        && filter_var($settings['from_email'], FILTER_VALIDATE_EMAIL)
        && (trim((string)$settings['username']) === '' || !empty($settings['password_ciphertext']));
}

function email_smtp_fallback_configured(array $config): bool
{
    $settings = $config['smtp'] ?? [];
    $host = trim((string)($settings['host'] ?? ''));
    $username = trim((string)($settings['username'] ?? ''));
    $password = (string)($settings['password'] ?? '');
    $encryption = (string)($settings['encryption'] ?? 'starttls');
    $port = (int)($settings['port'] ?? 587);

    return $host !== ''
        && $host !== 'mail.example.com'
        && !str_contains($host, 'replace-with')
        && filter_var($settings['from_email'] ?? '', FILTER_VALIDATE_EMAIL)
        && $port >= 1 && $port <= 65535
        && in_array($encryption, ['ssl', 'starttls', 'none'], true)
        && ($username === '' || ($password !== '' && $password !== 'change-this' && !str_contains($password, 'replace-with')));
}

function smtp_settings_for_delivery(array $config, array $settings): array
{
    if (empty($settings['host']) || !filter_var($settings['from_email'], FILTER_VALIDATE_EMAIL)
        || (trim((string)$settings['username']) !== '' && empty($settings['password_ciphertext']))) {
        throw new RuntimeException('Configure SMTP host, sender email, and authentication before sending email.');
    }
    return [
        'host' => $settings['host'],
        'port' => (int)$settings['port'],
        'encryption' => (bool)$settings['secure'] ? 'ssl' : 'starttls',
        'username' => $settings['username'],
        'password' => !empty($settings['password_ciphertext']) ? decrypt_secret($config, $settings['password_ciphertext']) : '',
        'from_email' => $settings['from_email'],
        'from_name' => $settings['from_name'],
    ];
}

function send_platform_email(PDO $pdo, array $config, string $recipient, string $subject, string $body): bool
{
    $settings = email_smtp_settings($pdo);
    if (!$settings || !(bool)$settings['enabled']) return false;
    if (email_smtp_database_settings_configured($settings)) {
        send_smtp_email($config, $recipient, $subject, $body, smtp_settings_for_delivery($config, $settings));
        return true;
    }
    if (!email_smtp_fallback_configured($config)) {
        throw new RuntimeException('Configure valid SMTP settings before sending email.');
    }
    send_smtp_email($config, $recipient, $subject, $body);
    return true;
}

function render_email_template(string $template, array $values): string
{
    return preg_replace_callback('/{{\s*([a-zA-Z0-9_]+)\s*}}/', static function (array $matches) use ($values): string {
        $value = $values[$matches[1]] ?? '';
        return is_scalar($value) ? (string)$value : '';
    }, $template) ?? $template;
}

function execute_function_request(PDO $pdo, array $config, string $name, array $body): array
{
    $action = (string)($body['action'] ?? '');
    $queueSecret = (string)($config['email_queue_secret'] ?? '');
    $providedQueueSecret = (string)($_SERVER['HTTP_X_EMAIL_QUEUE_SECRET'] ?? '');
    $isScheduledEmailWorker = $name === 'admin-email'
        && $action === 'process_queue'
        && strlen($queueSecret) >= 32
        && !str_contains($queueSecret, 'replace-with')
        && $providedQueueSecret !== ''
        && hash_equals($queueSecret, $providedQueueSecret);
    $admin = $isScheduledEmailWorker ? null : require_admin($pdo, $config);

    if ($name === 'admin-reset-password') {
        $userId = (string)($body['user_id'] ?? '');
        $statement = $pdo->prepare('SELECT id FROM users WHERE id = ? LIMIT 1');
        $statement->execute([$userId]);
        $target = $statement->fetch();
        if (!$target) respond(['error' => 'Account not found.'], 404);
        $token = create_action_token($pdo, $userId, 'password_reset');
        return ['action_link' => rtrim((string)$config['app']['base_url'], '/') . '/?reset-password=' . rawurlencode($token)];
    }

    if ($name !== 'admin-email') throw new InvalidArgumentException('Unknown backend function.');
    if ($isScheduledEmailWorker && $action !== 'process_queue') {
        respond(['error' => 'Scheduled worker may only process the email queue.'], 403);
    }
    $current = email_smtp_settings($pdo);

    if ($action === 'get_settings') {
        $fallbackConfigured = !email_smtp_database_settings_present($current) && email_smtp_fallback_configured($config);
        if (!$current) return ['settings' => null, 'fallback_configured' => $fallbackConfigured];
        return ['settings' => [
            'enabled' => (bool)$current['enabled'],
            'host' => $current['host'],
            'port' => (int)$current['port'],
            'secure' => (bool)$current['secure'],
            'username' => $current['username'],
            'from_email' => $current['from_email'],
            'from_name' => $current['from_name'],
            'password_configured' => (bool)$current['password_ciphertext'],
        ], 'fallback_configured' => $fallbackConfigured];
    }

    if ($action === 'save_settings') {
        $settings = $body['settings'] ?? null;
        if (!is_array($settings)
            || !filter_var($settings['from_email'] ?? '', FILTER_VALIDATE_EMAIL)
            || !is_string($settings['host'] ?? null)
            || trim($settings['host']) === ''
            || filter_var($settings['port'] ?? null, FILTER_VALIDATE_INT) === false
            || (int)$settings['port'] < 1 || (int)$settings['port'] > 65535) {
            respond(['error' => 'Enter a valid SMTP host, port, and sender email.'], 422);
        }
        $ciphertext = $current['password_ciphertext'] ?? null;
        if (is_string($body['password'] ?? null) && $body['password'] !== '') $ciphertext = encrypt_secret($config, $body['password']);
        $username = trim((string)($settings['username'] ?? ''));
        if (!empty($settings['enabled']) && $username !== '' && !$ciphertext) {
            respond(['error' => 'Enter the SMTP password before enabling email delivery.'], 422);
        }
        $statement = $pdo->prepare(
            'INSERT INTO email_smtp_settings (singleton, enabled, host, port, secure, username, from_email, from_name, password_ciphertext, updated_by)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), host = VALUES(host), port = VALUES(port), secure = VALUES(secure),
               username = VALUES(username), from_email = VALUES(from_email), from_name = VALUES(from_name),
               password_ciphertext = VALUES(password_ciphertext), updated_by = VALUES(updated_by)'
        );
        $statement->execute([
            !empty($settings['enabled']) ? 1 : 0,
            trim($settings['host']),
            (int)$settings['port'],
            (!empty($settings['secure']) || (int)$settings['port'] === 465) ? 1 : 0,
            $username,
            trim((string)$settings['from_email']),
            substr(trim((string)($settings['from_name'] ?? 'MrHustler')), 0, 120),
            $ciphertext,
            $admin['id'],
        ]);
        return ['saved' => true, 'password_configured' => (bool)$ciphertext];
    }

    if (!in_array($action, ['test', 'process_queue'], true)) throw new InvalidArgumentException('Unknown email operation.');
    if (!email_delivery_enabled($pdo)) respond(['error' => 'Email delivery is disabled. Enable it from Admin settings first.'], 400);
    $databaseSettingsPresent = email_smtp_database_settings_present($current);
    $databaseSettingsConfigured = email_smtp_database_settings_configured($current);
    if ($databaseSettingsConfigured) {
        $smtp = smtp_settings_for_delivery($config, $current);
    } elseif (!$databaseSettingsPresent && email_smtp_fallback_configured($config)) {
        $smtp = $config['smtp'];
    } else {
        respond(['error' => 'Configure valid SMTP settings before sending email.'], 400);
    }

    if ($action === 'test') {
        send_smtp_email($config, $admin['email'], 'MrHustler SMTP test', 'SMTP is configured correctly for MrHustler email notifications.', $smtp);
        return ['sent' => true, 'recipient' => $admin['email']];
    }

    $pdo->beginTransaction();
    $pdo->exec(
        "UPDATE email_notification_queue
         SET status = 'failed', processing_started_at = NULL, last_error = 'Previous queue worker stopped before completion.'
         WHERE status = 'processing' AND processing_started_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE"
    );
    $queueStatement = $pdo->query(
        "SELECT id, user_id, event_key, payload, attempts FROM email_notification_queue
         WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY created_at LIMIT 25 FOR UPDATE"
    );
    $queue = $queueStatement->fetchAll();
    $templates = $pdo->query('SELECT event_key, title, subject_template, body_template, enabled FROM email_notification_templates')->fetchAll();
    $templateByKey = [];
    foreach ($templates as $template) $templateByKey[$template['event_key']] = $template;
    $markProcessing = $pdo->prepare(
        "UPDATE email_notification_queue SET status = 'processing', attempts = attempts + 1,
         processing_started_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?"
    );
    foreach ($queue as $item) $markProcessing->execute([$item['id']]);
    $pdo->commit();

    $result = ['sent' => 0, 'failed' => 0, 'skipped' => 0];
    foreach ($queue as $item) {
        $template = $templateByKey[$item['event_key']] ?? null;
        if (!$template || !(bool)$template['enabled'] || !$item['user_id']) {
            $pdo->prepare("UPDATE email_notification_queue SET status = 'skipped', processing_started_at = NULL, last_error = ? WHERE id = ?")
                ->execute(['Missing/disabled template or user.', $item['id']]);
            $result['skipped']++;
            continue;
        }
        $statement = $pdo->prepare(
            'SELECT u.email, p.full_name, p.username FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ? LIMIT 1'
        );
        $statement->execute([$item['user_id']]);
        $account = $statement->fetch();
        if (!$account || !$account['email']) {
            $pdo->prepare("UPDATE email_notification_queue SET status = 'failed', processing_started_at = NULL, last_error = ? WHERE id = ?")
                ->execute(['User email unavailable.', $item['id']]);
            $result['failed']++;
            continue;
        }
        $payload = json_decode((string)$item['payload'], true);
        $values = is_array($payload) ? $payload : [];
        $values['first_name'] = explode(' ', trim((string)($account['full_name'] ?: $account['username'] ?: 'Hustler')))[0];
        $values['email'] = $account['email'];
        try {
            send_smtp_email(
                $config,
                $account['email'],
                render_email_template($template['subject_template'], $values),
                render_email_template($template['body_template'], $values),
                $smtp
            );
            $pdo->prepare("UPDATE email_notification_queue SET status = 'sent', processing_started_at = NULL, sent_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ?")
                ->execute([$item['id']]);
            $result['sent']++;
        } catch (Throwable $error) {
            error_log('MrHustler queued email failure: ' . safe_email_error($error));
            $pdo->prepare("UPDATE email_notification_queue SET status = 'failed', processing_started_at = NULL, last_error = ? WHERE id = ?")
                ->execute([safe_email_error($error), $item['id']]);
            $result['failed']++;
        }
    }
    return $result;
}

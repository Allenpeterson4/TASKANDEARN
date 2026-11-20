<?php
declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/data.php';
require __DIR__ . '/storage.php';
require __DIR__ . '/functions.php';
require __DIR__ . '/rpc.php';
require __DIR__ . '/payments.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

try {
    $pdo = database($config);

    if ($path === '/api/health' && $method === 'GET') {
        $pdo->query('SELECT 1');
        respond(['ok' => true, 'database' => 'mysql']);
    }

    if (preg_match('#^/api/payments/webhook/(paystack|flutterwave)$#', $path, $paymentMatch) && $method === 'POST') {
        $rawBody = file_get_contents('php://input');
        if (!is_string($rawBody)) respond(['error' => 'Could not read payment event.'], 400);
        $signature = $paymentMatch[1] === 'paystack'
            ? (string)($_SERVER['HTTP_X_PAYSTACK_SIGNATURE'] ?? '')
            : (string)($_SERVER['HTTP_VERIF_HASH'] ?? '');
        respond(handle_gateway_webhook($pdo, $config, $paymentMatch[1], $rawBody, $signature));
    }

    if ($path === '/api/task-verification/complete' && $method === 'POST') {
        $secret = (string)($config['task_verification']['secret'] ?? '');
        if (strlen($secret) < 32 || str_contains($secret, 'replace-with')) {
            respond(['error' => 'Task verification callback is not configured.'], 503);
        }
        $rawBody = file_get_contents('php://input');
        if (!is_string($rawBody)) respond(['error' => 'Could not read request body.'], 400);
        if (strlen($rawBody) > 8192) respond(['error' => 'Request body is too large.'], 413);
        $providedSignature = (string)($_SERVER['HTTP_X_TASK_VERIFICATION_SIGNATURE'] ?? '');
        $expectedSignature = hash_hmac('sha256', $rawBody, $secret);
        if ($providedSignature === '' || !hash_equals($expectedSignature, $providedSignature)) {
            respond(['error' => 'Invalid signature.'], 401);
        }
        $body = json_decode($rawBody, true);
        if (!is_array($body)) respond(['error' => 'Invalid JSON payload.'], 400);
        $trackingId = $body['tracking_id'] ?? null;
        $providerReference = $body['provider_reference'] ?? null;
        if (!is_string($trackingId) || !preg_match('/^[a-f0-9-]{36}$/i', $trackingId)) {
            respond(['error' => 'A valid tracking_id is required.'], 400);
        }
        if ($providerReference !== null && (!is_string($providerReference) || strlen($providerReference) > 200)) {
            respond(['error' => 'Invalid provider reference.'], 400);
        }
        $completionId = complete_verified_task_session($pdo, $trackingId, $providerReference);
        respond(['verified' => true, 'completion_id' => $completionId]);
    }

    if ($path === '/api/data' && $method === 'POST') {
        respond(execute_data_request($pdo, $config, request_data()));
    }

    if (preg_match('#^/api/functions/([a-z0-9-]+)$#', $path, $functionMatch) && $method === 'POST') {
        respond(execute_function_request($pdo, $config, $functionMatch[1], request_data()));
    }

    if (preg_match('#^/api/rpc/([a-z0-9_]+)$#', $path, $rpcMatch) && $method === 'POST') {
        respond(['data' => execute_rpc_request($pdo, $config, $rpcMatch[1], request_data())]);
    }

    if ($path === '/api/storage/upload' && $method === 'POST') {
        respond(storage_upload($pdo, $config));
    }

    if ($path === '/api/storage/public' && $method === 'GET') {
        serve_storage_file($pdo, $config, false);
    }

    if ($path === '/api/storage/signed' && $method === 'GET') {
        serve_storage_file($pdo, $config, true);
    }

    if ($path === '/api/storage/signed-url' && $method === 'POST') {
        respond(execute_storage_request($pdo, $config, 'signed-url', request_data()));
    }

    if ($path === '/api/storage/list' && $method === 'POST') {
        respond(execute_storage_request($pdo, $config, 'list', request_data()));
    }

    if ($path === '/api/storage/remove' && $method === 'POST') {
        respond(execute_storage_request($pdo, $config, 'remove', request_data()));
    }

    if ($path === '/api/auth/session' && $method === 'GET') {
        $user = request_user($pdo, $config);
        respond(['user' => $user]);
    }

    if ($path === '/api/auth/mfa' && $method === 'GET') {
        $user = require_admin($pdo, $config, false);
        respond([
            'enabled' => (bool)$user['app_metadata']['mfa_enabled'],
            'verified' => (bool)$user['app_metadata']['mfa_verified'],
        ]);
    }

    if ($path === '/api/auth/mfa/enroll' && $method === 'POST') {
        $user = require_admin($pdo, $config, false);
        if ($user['app_metadata']['mfa_enabled']) respond(['error' => 'An authenticator is already enabled.'], 409);
        $secret = base32_encode(random_bytes(20));
        $pdo->beginTransaction();
        $pdo->prepare(
            'INSERT INTO admin_mfa_factors (id, user_id, secret_ciphertext, verified_at) VALUES (?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE id = id'
        )->execute([uuid_v4(), $user['id'], encrypt_secret($config, $secret)]);
        $statement = $pdo->prepare('SELECT secret_ciphertext, verified_at FROM admin_mfa_factors WHERE user_id = ? FOR UPDATE');
        $statement->execute([$user['id']]);
        $factor = $statement->fetch();
        if (!$factor || $factor['verified_at'] !== null) {
            $pdo->rollBack();
            respond(['error' => 'An authenticator is already enabled.'], 409);
        }
        $secret = decrypt_secret($config, $factor['secret_ciphertext']);
        $pdo->commit();
        $label = rawurlencode('MrHustler:' . $user['email']);
        $uri = 'otpauth://totp/' . $label . '?secret=' . $secret . '&issuer=MrHustler&algorithm=SHA1&digits=6&period=30';
        respond(['secret' => $secret, 'otpauth_uri' => $uri]);
    }

    if ($path === '/api/auth/mfa/verify' && $method === 'POST') {
        $user = require_admin($pdo, $config, false);
        $body = request_data();
        $code = trim((string)($body['code'] ?? ''));
        $statement = $pdo->prepare('SELECT secret_ciphertext, verified_at FROM admin_mfa_factors WHERE user_id = ? LIMIT 1');
        $statement->execute([$user['id']]);
        $factor = $statement->fetch();
        if (!$factor || !verify_totp(decrypt_secret($config, $factor['secret_ciphertext']), $code)) {
            respond(['error' => 'Verification failed. Check the code and try again.'], 422);
        }
        $pdo->beginTransaction();
        $pdo->prepare('UPDATE admin_mfa_factors SET verified_at = COALESCE(verified_at, UTC_TIMESTAMP(3)) WHERE user_id = ?')->execute([$user['id']]);
        $cookieName = $config['app']['session_cookie'] ?? 'mrhustler_session';
        $token = $_COOKIE[$cookieName] ?? '';
        $pdo->prepare('UPDATE auth_sessions SET mfa_verified_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND user_id = ?')
            ->execute([hash('sha256', (string)$token), $user['id']]);
        $pdo->commit();
        respond(['ok' => true]);
    }

    if ($path === '/api/auth/signup' && $method === 'POST') {
        $body = request_data();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        $fullName = trim((string)($body['fullName'] ?? ''));
        $phone = trim((string)($body['phone'] ?? ''));
        $referralCode = strtoupper(trim((string)($body['referralCode'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6 || $fullName === '') {
            respond(['error' => 'Enter a valid email, your name, and a password of at least 6 characters.'], 422);
        }
        if (!consume_auth_email_rate_limit($pdo, $email, 'signup')) {
            respond(['error' => 'Too many account requests. Try again later.'], 429);
        }
        $existing = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $existing->execute([$email]);
        if ($existing->fetch()) respond(['ok' => true, 'verification_required' => null]);
        $emailDeliveryEnabled = email_delivery_enabled($pdo);

        $userId = uuid_v4();
        $profileId = uuid_v4();
        $referralCodeForUser = 'MH' . strtoupper(bin2hex(random_bytes(5)));
        $usernameBase = preg_replace('/[^a-z0-9_]/i', '', strstr($email, '@', true) ?: 'member') ?: 'member';
        $referrerId = null;
        if ($referralCode !== '') {
            $referrer = $pdo->prepare('SELECT user_id FROM profiles WHERE referral_code = ? LIMIT 1');
            $referrer->execute([$referralCode]);
            $foundReferrer = $referrer->fetch();
            if ($foundReferrer) $referrerId = $foundReferrer['user_id'];
        }

        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)')
            ->execute([$userId, $email, password_hash($password, PASSWORD_DEFAULT)]);
        $pdo->prepare(
            'INSERT INTO profiles (id, user_id, username, full_name, phone, referral_code) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$profileId, $userId, substr($usernameBase, 0, 60), $fullName, $phone ?: null, $referralCodeForUser]);
        $pdo->prepare('INSERT INTO balances (id, user_id) VALUES (?, ?)')->execute([uuid_v4(), $userId]);
        if ($referrerId !== null && $referrerId !== $userId && user_feature_enabled($pdo, $referrerId, 'referrals')) {
            $referralId = uuid_v4();
            $pdo->prepare('INSERT INTO referrals (id, referrer_id, referred_id) VALUES (?, ?, ?)')
                ->execute([$referralId, $referrerId, $userId]);
            award_referral_signup_reward($pdo, $referralId, $referrerId);
            $referralCount = $pdo->prepare('SELECT COUNT(*) FROM referrals WHERE referrer_id = ?');
            $referralCount->execute([$referrerId]);
            $count = (int)$referralCount->fetchColumn();
            $tier = $count >= 50 ? 'Platinum' : ($count >= 20 ? 'Gold' : ($count >= 5 ? 'Silver' : 'Bronze'));
            $pdo->prepare('UPDATE profiles SET tier = ? WHERE user_id = ?')->execute([$tier, $referrerId]);
            queue_email_notification($pdo, $referrerId, 'referral_registered', [
                'referred_name' => $fullName !== '' ? $fullName : 'Your friend',
                'event_date' => gmdate('Y-m-d'),
            ]);
            award_milestone_rewards($pdo, $referrerId, 'referrals', $count);
        }
        if ($emailDeliveryEnabled) {
            $token = create_action_token($pdo, $userId, 'verify_email');
            $verifyUrl = rtrim((string)$config['app']['base_url'], '/') . '/?verify-email=' . rawurlencode($token);
            send_platform_email($pdo, $config, $email, 'Verify your MrHustler account', "Welcome to MrHustler, {$fullName}.\n\nVerify your email address using this link:\n{$verifyUrl}\n\nThis link expires in 24 hours.");
        }
        $pdo->commit();
        respond(['ok' => true, 'verification_required' => $emailDeliveryEnabled]);
    }

    if ($path === '/api/auth/verify-email' && $method === 'POST') {
        $body = request_data();
        $token = (string)($body['token'] ?? '');
        if ($token === '') respond(['error' => 'Verification link is invalid or expired.'], 422);
        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            "SELECT user_id, consumed_at, (expires_at > UTC_TIMESTAMP(3)) AS token_valid
             FROM auth_action_tokens WHERE token_hash = ? AND purpose = 'verify_email' FOR UPDATE"
        );
        $statement->execute([hash('sha256', $token)]);
        $action = $statement->fetch();
        if (!$action) {
            $pdo->rollBack();
            respond(['error' => 'Verification link is invalid or expired.'], 422);
        }
        if ($action['consumed_at'] !== null) {
            $pdo->commit();
            respond(['ok' => true]);
        }
        if (!(bool)$action['token_valid']) {
            $pdo->rollBack();
            respond(['error' => 'Verification link is invalid or expired.'], 422);
        }
        $pdo->prepare('UPDATE users SET email_verified_at = UTC_TIMESTAMP(3) WHERE id = ?')->execute([$action['user_id']]);
        $pdo->prepare('UPDATE auth_action_tokens SET consumed_at = UTC_TIMESTAMP(3) WHERE token_hash = ?')->execute([hash('sha256', $token)]);
        $pdo->commit();
        respond(['ok' => true]);
    }

    if ($path === '/api/auth/password-reset-request' && $method === 'POST') {
        $body = request_data();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(['error' => 'Enter a valid email address.'], 422);
        if (!consume_auth_email_rate_limit($pdo, $email, 'password_reset')) {
            respond(['error' => 'Too many account requests. Try again later.'], 429);
        }
        $statement = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $statement->execute([$email]);
        $user = $statement->fetch();
        if ($user && email_delivery_enabled($pdo)) {
            $pdo->beginTransaction();
            $token = create_action_token($pdo, $user['id'], 'password_reset');
            $resetUrl = rtrim((string)$config['app']['base_url'], '/') . '/?reset-password=' . rawurlencode($token);
            send_platform_email($pdo, $config, $email, 'Reset your MrHustler password', "Use this link to reset your password:\n{$resetUrl}\n\nThis link expires in one hour. If you did not request a reset, ignore this email.");
            $pdo->commit();
        }
        respond(['ok' => true]);
    }

    if ($path === '/api/auth/password-reset' && $method === 'POST') {
        $body = request_data();
        $token = (string)($body['token'] ?? '');
        $password = (string)($body['password'] ?? '');
        if ($token === '' || strlen($password) < 6) respond(['error' => 'The reset link or password is invalid.'], 422);
        $pdo->beginTransaction();
        $statement = $pdo->prepare(
            "SELECT user_id FROM auth_action_tokens WHERE token_hash = ? AND purpose = 'password_reset' AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE"
        );
        $statement->execute([hash('sha256', $token)]);
        $action = $statement->fetch();
        if (!$action) {
            $pdo->rollBack();
            respond(['error' => 'The reset link is invalid or expired.'], 422);
        }
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $action['user_id']]);
        $pdo->prepare('UPDATE auth_action_tokens SET consumed_at = UTC_TIMESTAMP(3) WHERE token_hash = ?')->execute([hash('sha256', $token)]);
        $pdo->prepare('DELETE FROM auth_sessions WHERE user_id = ?')->execute([$action['user_id']]);
        $pdo->commit();
        respond(['ok' => true]);
    }

    if ($path === '/api/auth/password' && $method === 'POST') {
        $user = request_user($pdo, $config);
        if (!$user) respond(['error' => 'Sign in to change your password.'], 401);
        $body = request_data();
        $currentPassword = (string)($body['currentPassword'] ?? '');
        $newPassword = (string)($body['newPassword'] ?? '');
        if (strlen($newPassword) < 6) respond(['error' => 'Password must be at least 6 characters.'], 422);
        $statement = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $statement->execute([$user['id']]);
        $passwordHash = $statement->fetchColumn();
        if (!is_string($passwordHash) || !password_verify($currentPassword, $passwordHash)) {
            respond(['error' => 'Current password is incorrect.'], 403);
        }
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($newPassword, PASSWORD_DEFAULT), $user['id']]);
        respond(['ok' => true]);
    }

    if ($path === '/api/auth/login' && $method === 'POST') {
        $body = request_data();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
            respond(['error' => 'Enter a valid email address and password.'], 422);
        }

        $statement = $pdo->prepare(
            'SELECT u.id, u.email, u.password_hash, u.email_verified_at, u.account_status, u.role,
                    p.account_status AS profile_status
             FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.email = ? LIMIT 1'
        );
        $statement->execute([$email]);
        $user = $statement->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            respond(['error' => 'Invalid email or password.'], 401);
        }
        if ($user['account_status'] !== 'active' || $user['profile_status'] !== 'active') respond(['error' => 'This account is not active.'], 403);
        if ($user['email_verified_at'] === null && email_delivery_enabled($pdo)) {
            if (!consume_auth_email_rate_limit($pdo, $email, 'verify_email')) {
                respond(['error' => 'Too many verification requests. Try again later.'], 429);
            }
            $pdo->beginTransaction();
            $token = create_action_token($pdo, $user['id'], 'verify_email');
            $verifyUrl = rtrim((string)$config['app']['base_url'], '/') . '/?verify-email=' . rawurlencode($token);
            send_platform_email(
                $pdo,
                $config,
                $email,
                'Verify your MrHustler account',
                "Verify your email address using this link:\n{$verifyUrl}\n\nThis link expires in 24 hours."
            );
            $pdo->commit();
            respond(['error' => 'Verify your email before signing in. A new confirmation link has been sent.'], 403);
        }

        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= UTC_TIMESTAMP(3)')->execute([$user['id']]);
        issue_session($pdo, $config, $user['id'], $user['role'] === 'admin');
        $pdo->prepare('INSERT INTO user_login_history (id, user_id, ip_address, user_agent) VALUES (?, ?, ?, ?)')
            ->execute([
                uuid_v4(),
                $user['id'],
                substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45),
                substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 1000),
            ]);
        $pdo->commit();
        $signedInUser = user_by_id($pdo, $user['id']);
        respond(['user' => $signedInUser]);
    }

    if ($path === '/api/auth/logout' && $method === 'POST') {
        $cookieName = $config['app']['session_cookie'] ?? 'mrhustler_session';
        $token = $_COOKIE[$cookieName] ?? '';
        if (is_string($token) && preg_match('/^[A-Za-z0-9_-]{40,100}$/', $token)) {
            $pdo->prepare('DELETE FROM auth_sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
        }
        setcookie($cookieName, '', ['expires' => 1, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        respond(['ok' => true]);
    }

    respond(['error' => 'Route not found.'], 404);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('MrHustler API failure: ' . $error->getMessage());
    if ($error instanceof InvalidArgumentException) respond(['error' => $error->getMessage()], 422);
    respond(['error' => 'The backend could not complete the request.'], 500);
}

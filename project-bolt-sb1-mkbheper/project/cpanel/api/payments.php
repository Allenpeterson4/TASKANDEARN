<?php
declare(strict_types=1);

function payment_secret(array $config, string $provider, string $key = 'secret_key'): string
{
    $secret = (string)($config['payments'][$provider . '_' . $key] ?? '');
    if (strlen($secret) < 20 || str_contains($secret, 'replace-with')) {
        throw new RuntimeException(ucfirst($provider) . ' payment credentials are not configured.');
    }
    return $secret;
}

function payment_http_request(string $method, string $url, string $secret, ?array $payload = null): array
{
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $secret,
    ];
    $options = [
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'timeout' => 20,
        'ignore_errors' => true,
    ];
    if ($payload !== null) {
        $options['header'] .= "\r\nContent-Type: application/json";
        $options['content'] = json_encode($payload, JSON_THROW_ON_ERROR);
    }
    $context = stream_context_create(['http' => $options, 'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
    set_error_handler(static function (int $severity, string $message): never {
        throw new RuntimeException('Payment provider connection failed: ' . $message);
    });
    try {
        $body = file_get_contents($url, false, $context);
    } finally {
        restore_error_handler();
    }
    if (!is_string($body)) throw new RuntimeException('Payment provider returned no response.');
    $result = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
    $statusLine = $http_response_header[0] ?? '';
    if (!preg_match('/\s([0-9]{3})\s/', $statusLine, $statusMatch) || (int)$statusMatch[1] < 200 || (int)$statusMatch[1] >= 300) {
        throw new RuntimeException('Payment provider request failed.');
    }
    if (!is_array($result)) throw new RuntimeException('Payment provider returned an invalid response.');
    return $result;
}

function initialize_gateway_checkout(
    array $config,
    string $provider,
    string $email,
    string $name,
    float $amount,
    string $reference,
    array $metadata
): string {
    $secret = payment_secret($config, $provider);
    $baseUrl = rtrim((string)($config['app']['base_url'] ?? ''), '/');
    if (!filter_var($baseUrl, FILTER_VALIDATE_URL) || !preg_match('/^https:\/\//i', $baseUrl)) {
        throw new RuntimeException('Configure an HTTPS application base URL before enabling online payments.');
    }
    if ($provider === 'paystack') {
        $response = payment_http_request('POST', 'https://api.paystack.co/transaction/initialize', $secret, [
            'email' => $email,
            'amount' => (int)round($amount * 100),
            'currency' => 'NGN',
            'reference' => $reference,
            'callback_url' => $baseUrl . '/?payment_return=1',
            'metadata' => $metadata,
        ]);
        $url = $response['data']['authorization_url'] ?? null;
        $host = is_string($url) ? strtolower((string)parse_url($url, PHP_URL_HOST)) : '';
        if (($response['status'] ?? false) !== true || !is_string($url) || !filter_var($url, FILTER_VALIDATE_URL)
            || parse_url($url, PHP_URL_SCHEME) !== 'https' || !($host === 'checkout.paystack.com' || str_ends_with($host, '.paystack.com'))) {
            throw new RuntimeException('Paystack could not initialize this payment.');
        }
        return $url;
    }
    if ($provider === 'flutterwave') {
        $response = payment_http_request('POST', 'https://api.flutterwave.com/v3/payments', $secret, [
            'tx_ref' => $reference,
            'amount' => number_format($amount, 2, '.', ''),
            'currency' => 'NGN',
            'redirect_url' => $baseUrl . '/?payment_return=1',
            'customer' => ['email' => $email, 'name' => $name],
            'meta' => $metadata,
        ]);
        $url = $response['data']['link'] ?? null;
        $host = is_string($url) ? strtolower((string)parse_url($url, PHP_URL_HOST)) : '';
        if (($response['status'] ?? '') !== 'success' || !is_string($url) || !filter_var($url, FILTER_VALIDATE_URL)
            || parse_url($url, PHP_URL_SCHEME) !== 'https'
            || !(str_ends_with($host, '.flutterwave.com') || str_ends_with($host, '.flutterwavego.com'))) {
            throw new RuntimeException('Flutterwave could not initialize this payment.');
        }
        return $url;
    }
    throw new InvalidArgumentException('Unsupported payment provider.');
}

function verify_gateway_transaction(array $config, string $provider, string $reference, ?string $transactionId): array
{
    $secret = payment_secret($config, $provider);
    if ($provider === 'paystack') {
        $result = payment_http_request(
            'GET',
            'https://api.paystack.co/transaction/verify/' . rawurlencode($reference),
            $secret
        );
        $data = $result['data'] ?? null;
        if (($result['status'] ?? false) !== true || !is_array($data)) throw new RuntimeException('Paystack verification failed.');
        return [
            'successful' => ($data['status'] ?? '') === 'success',
            'reference' => (string)($data['reference'] ?? ''),
            'currency' => (string)($data['currency'] ?? ''),
            'amount' => (float)($data['amount'] ?? 0) / 100,
        ];
    }
    if ($provider === 'flutterwave') {
        if ($transactionId === null || !preg_match('/^[0-9]{1,30}$/', $transactionId)) {
            throw new RuntimeException('Flutterwave transaction ID is missing or invalid.');
        }
        $result = payment_http_request(
            'GET',
            'https://api.flutterwave.com/v3/transactions/' . rawurlencode($transactionId) . '/verify',
            $secret
        );
        $data = $result['data'] ?? null;
        if (($result['status'] ?? '') !== 'success' || !is_array($data)) throw new RuntimeException('Flutterwave verification failed.');
        return [
            'successful' => ($data['status'] ?? '') === 'successful',
            'reference' => (string)($data['tx_ref'] ?? ''),
            'currency' => (string)($data['currency'] ?? ''),
            'amount' => (float)($data['amount'] ?? 0),
        ];
    }
    throw new InvalidArgumentException('Unsupported payment provider.');
}

function handle_gateway_webhook(PDO $pdo, array $config, string $provider, string $rawBody, string $signature): array
{
    if (strlen($rawBody) > 65536) respond(['error' => 'Webhook payload is too large.'], 413);
    if ($provider === 'paystack') {
        $secret = payment_secret($config, 'paystack');
        if ($signature === '' || !hash_equals(hash_hmac('sha512', $rawBody, $secret), $signature)) {
            respond(['error' => 'Invalid payment signature.'], 401);
        }
    } elseif ($provider === 'flutterwave') {
        $secretHash = payment_secret($config, 'flutterwave', 'webhook_secret_hash');
        if ($signature === '' || !hash_equals($secretHash, $signature)) respond(['error' => 'Invalid payment signature.'], 401);
    } else {
        respond(['error' => 'Unsupported payment provider.'], 404);
    }

    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) respond(['error' => 'Invalid webhook payload.'], 400);
    if ($provider === 'paystack' && ($payload['event'] ?? '') !== 'charge.success') return ['received' => true, 'processed' => false];
    if ($provider === 'flutterwave' && (($payload['event'] ?? '') !== 'charge.completed' || ($payload['data']['status'] ?? '') !== 'successful')) {
        return ['received' => true, 'processed' => false];
    }
    $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
    $reference = $provider === 'paystack' ? (string)($data['reference'] ?? '') : (string)($data['tx_ref'] ?? '');
    $transactionId = $provider === 'flutterwave' && isset($data['id']) ? (string)$data['id'] : null;
    if ($reference === '' || strlen($reference) > 255) respond(['error' => 'Payment reference is missing.'], 400);

    $depositQuery = $pdo->prepare('SELECT id, amount, status FROM funding_deposits WHERE provider_reference = ? AND payment_method = ? LIMIT 1');
    $depositQuery->execute([$reference, $provider]);
    $deposit = $depositQuery->fetch();
    $subscriptionQuery = $pdo->prepare('SELECT id, amount, status FROM user_subscriptions WHERE provider_reference = ? AND provider = ? LIMIT 1');
    $subscriptionQuery->execute([$reference, $provider]);
    $subscription = $subscriptionQuery->fetch();
    if (!$deposit && !$subscription) return ['received' => true, 'processed' => false];
    $record = $deposit ?: $subscription;
    if ($record['status'] !== 'pending') return ['received' => true, 'processed' => true];

    $verified = verify_gateway_transaction($config, $provider, $reference, $transactionId);
    if (!$verified['successful'] || $verified['reference'] !== $reference || $verified['currency'] !== 'NGN'
        || $verified['amount'] + 0.009 < (float)$record['amount']) {
        respond(['error' => 'Payment does not match the pending transaction.'], 409);
    }

    $pdo->beginTransaction();
    if ($deposit) {
        $query = $pdo->prepare('SELECT * FROM funding_deposits WHERE id = ? FOR UPDATE');
        $query->execute([$deposit['id']]);
        $deposit = $query->fetch();
        if ($deposit && $deposit['status'] === 'pending') {
            $balanceQuery = $pdo->prepare('SELECT fund_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $balanceQuery->execute([$deposit['user_id']]);
            $before = $balanceQuery->fetchColumn();
            if ($before === false) respond(['error' => 'Funding wallet not found.'], 409);
            $after = (float)$before + (float)$deposit['amount'];
            if ($after >= 10000000000) respond(['error' => 'Funding wallet limit exceeded.'], 409);
            $pdo->prepare('UPDATE balances SET fund_balance = ? WHERE user_id = ?')->execute([$after, $deposit['user_id']]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$deposit['user_id'],
                null,
                'fund',
                $deposit['amount'],
                $before,
                $after,
                'Confirmed wallet funding deposit ' . $deposit['id']
            );
            $pdo->prepare("UPDATE funding_deposits SET status = 'confirmed', reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?")
                ->execute([$deposit['id']]);
            queue_email_notification($pdo, (string)$deposit['user_id'], 'funding_confirmed', [
                'amount' => (string)$deposit['amount'],
            ]);
        }
    } else {
        $query = $pdo->prepare('SELECT s.*, p.billing_period FROM user_subscriptions s JOIN subscription_plans p USING (plan_code) WHERE s.id = ? FOR UPDATE');
        $query->execute([$subscription['id']]);
        $subscription = $query->fetch();
        if ($subscription && $subscription['status'] === 'pending') {
            $activeQuery = $pdo->prepare(
                "SELECT id FROM user_subscriptions WHERE user_id = ? AND id <> ? AND status = 'active'
                 AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3)) LIMIT 1 FOR UPDATE"
            );
            $activeQuery->execute([$subscription['user_id'], $subscription['id']]);
            if ($activeQuery->fetch()) respond(['error' => 'User already has an active paid plan.'], 409);
            $endExpression = $subscription['billing_period'] === 'lifetime'
                ? 'NULL'
                : 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY)';
            $pdo->prepare(
                "UPDATE user_subscriptions SET status = 'active', starts_at = UTC_TIMESTAMP(3),
                 ends_at = {$endExpression}, expires_at = NULL WHERE id = ?"
            )->execute([$subscription['id']]);
            queue_subscription_activated_email($pdo, (string)$subscription['user_id'], (string)$subscription['plan_code']);
        }
    }
    $pdo->commit();
    return ['received' => true, 'processed' => true];
}

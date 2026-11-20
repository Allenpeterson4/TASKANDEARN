<?php
declare(strict_types=1);

return [
    'database' => [
        'host' => 'localhost',
        'name' => 'cpanel_database',
        'user' => 'cpanel_database_user',
        'password' => 'change-this',
        'charset' => 'utf8mb4',
    ],
    'app' => [
        'base_url' => 'https://www.mrhustle.com.ng',
        'session_cookie' => 'mrhustler_session',
        'session_lifetime_seconds' => 2592000,
        'secret_key' => 'replace-with-a-random-64-character-secret',
    ],
    'smtp' => [
        'host' => 'mail.example.com',
        'port' => 587,
        'encryption' => 'starttls',
        'username' => 'noreply@example.com',
        'password' => 'change-this',
        'from_email' => 'noreply@example.com',
        'from_name' => 'MrHustler',
    ],
    'storage' => [
        'path' => __DIR__ . '/storage',
        'max_upload_bytes' => 10485760,
    ],
    'task_verification' => [
        'secret' => 'replace-with-a-random-64-character-callback-secret',
    ],
    'email_queue_secret' => 'replace-with-a-random-64-character-email-queue-secret',
    'payments' => [
        'paystack_secret_key' => '',
        'flutterwave_secret_key' => '',
        'flutterwave_webhook_secret_hash' => '',
    ],
];

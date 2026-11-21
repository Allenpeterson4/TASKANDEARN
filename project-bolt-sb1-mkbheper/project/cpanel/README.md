# cPanel PHP and MySQL backend

The browser application uses the same-origin PHP API in `cpanel/api/`; it does not connect to Supabase. Files in `supabase/migrations/` are retained only as historical reference and are not an active runtime dependency.

For the full cPanel setup procedure, see [INSTALLATION.md](INSTALLATION.md). The complete MySQL install query is [`database/schema.sql`](database/schema.sql).

## Requirements

- MySQL 8.0.16 or later (for enforced `CHECK` constraints)
- PHP 8.1+ with `pdo_mysql` and OpenSSL
- Apache with `mod_rewrite`, HTTPS, and PHP support

## Install

1. Create a fresh MySQL database and user in cPanel, then grant the user full privileges on that database.
2. Import `database/schema.sql` into the empty database.
3. Copy `config.example.php` to `config.php`. Set the database credentials, production `app.base_url`, and a unique random `app.secret_key` of at least 64 characters. Do not use the example values.
4. Upload the contents of the Vite `dist/` directory to `public_html/` and upload the whole `cpanel/` directory beside it as `public_html/cpanel/`. Keep `config.php`, `database/`, and `storage/` inside `cpanel/`; the included `.htaccess` files protect these paths.
5. Keep `public/.htaccess` as the deployed document-root `.htaccess`. It routes `/api/*` to `cpanel/api/` and sends other application routes to `index.html`.
6. Confirm `https://your-domain.example/api/health` returns `{"ok":true,"database":"mysql"}`.

The private storage directory is `cpanel/storage/`. Do not move it under a public URL or remove its `.htaccess`. Back up both the MySQL database and this directory.

## Admin and email setup

Create an initial administrator through a private, trusted database session by setting `users.role = 'admin'` for the intended account. Never expose an admin role update through a public endpoint. Admin sign-in uses the account email and password. Authenticator-based 2FA is optional and can be enabled or disabled by that administrator from **Admin → Security & 2FA**; once enabled, future admin sessions require a valid code.

The **Admin → Email & templates** enabled toggle is authoritative for all outbound email; private SMTP settings in `config.php` can provide transport credentials but never bypass the toggle. While email is disabled, signup succeeds without sending a verification message and unverified accounts may sign in. Password-reset requests return a generic response without sending mail, and queued notifications remain pending. After an administrator enables email, unverified users must verify before signing in or using existing sessions; their next login sends a fresh verification link. Verification and password-reset links use `app.base_url` and return to the active site domain. Email notifications can be processed manually in the admin panel or unattended by a trusted scheduler, but queue processing also requires email to be enabled. For unattended delivery, set `email_queue_secret` in `config.php` to a random secret of at least 32 characters and have the scheduler send a POST request to `/api/functions/admin-email` with `Content-Type: application/json`, `X-Email-Queue-Secret: <secret>`, and body `{"action":"process_queue"}`. Protect this secret like a password; the secret is accepted only for queue processing. Keep the application secret and SMTP credentials out of the web root where possible and never commit `config.php`.

## Online payments

Online checkout requires provider credentials in `config.php` under `payments`:

- `paystack_secret_key`
- `flutterwave_secret_key`
- `flutterwave_webhook_secret_hash`

In the provider dashboards, configure webhook URLs as `https://your-domain.example/api/payments/webhook/paystack` and `https://your-domain.example/api/payments/webhook/flutterwave`. Paystack events are verified with its HMAC signature and then checked against the provider transaction API. Flutterwave events are checked against the configured webhook hash and verified transaction API. Use live credentials only on HTTPS production domains. Manual funding and manual plan payment remain available without gateway credentials.

## Automatic task verification

Set a unique `task_verification.secret` (at least 32 characters) in `config.php` and share it only with trusted campaign partners. Partners must HMAC-SHA256 the exact JSON request body and POST the hex digest in `x-task-verification-signature` to `https://your-domain.example/api/task-verification/complete`. The body contains `tracking_id` and optional `provider_reference`. A task click or redirect by itself does not earn a reward.

## Validation and deployment limits

The Vite frontend can be type-checked, linted, and production-built independently. Before using real users or payments, run the schema and PHP API against the target MySQL 8/cPanel environment and test email delivery, storage uploads, admin MFA, all wallet transactions, provider webhooks, and the task partner callback. A frontend build alone does not verify database compatibility or provider configuration.

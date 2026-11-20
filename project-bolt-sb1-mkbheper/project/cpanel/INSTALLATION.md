# cPanel Installation Guide

This package deploys the React frontend and PHP/MySQL API on one HTTPS domain. It is intended for a **fresh MySQL database**.

## 1. Check hosting requirements

In cPanel, confirm the account has:

- MySQL 8.0.16 or later
- PHP 8.1 or later with `pdo_mysql` and OpenSSL enabled
- Apache URL rewriting (`mod_rewrite`)
- HTTPS enabled for the domain

## 2. Create the database

1. Open **MySQL Databases** in cPanel.
2. Create a database and a database user with a strong password.
3. Add the user to the database and grant all privileges.
4. Record the full cPanel-prefixed database name, username, and database host.

## 3. Import the complete schema

The complete MySQL schema is [`database/schema.sql`](database/schema.sql). It creates the application tables, indexes, constraints, and initial platform settings and templates.

Using phpMyAdmin:

1. Open **phpMyAdmin** and select the new, empty database.
2. Choose **Import**, select `database/schema.sql`, and start the import.
3. Confirm the import completes without errors.

If shell access is enabled, the equivalent command is:

```sh
mysql -h localhost -u CPANEL_DATABASE_USER -p CPANEL_DATABASE_NAME < database/schema.sql
```

Replace the example database values. Enter the database password only at the prompt. Do not import this install schema over an existing production database.

## 4. Configure the PHP backend

1. Copy `cpanel/config.example.php` to `cpanel/config.php`.
2. Edit `config.php` and set:
   - `database.host`, `database.name`, `database.user`, and `database.password`
   - `app.base_url` to the final HTTPS domain, without a trailing slash. For `mrhustle.com.ng`, use `https://www.mrhustle.com.ng` unless AutoSSL is confirmed for the apex domain.
   - `app.secret_key` to a unique random value of at least 64 characters
   - SMTP settings if using the private `config.php` SMTP fallback
   - `task_verification.secret` to a unique random value of at least 32 characters
   - `email_queue_secret` to a unique random value of at least 32 characters
3. Replace every placeholder value. Keep `config.php` private and never upload it to a public source repository.

Generate a 64-character hexadecimal secret with PHP:

```sh
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Run it separately for each secret; do not reuse the same value. Payment credentials are optional until online Paystack or Flutterwave payments are enabled.

## 5. Upload and extract the production ZIP

Upload `MrHustler-cPanel-Production.zip` to the domain's document root (commonly `public_html`) and extract it **there**. The archive already contains the built frontend at the root and the backend in `cpanel/`.

The resulting layout should include:

```text
public_html/
  .htaccess
  index.html
  assets/
  mrhustler-social-logo.png
  cpanel/
    config.php
    config.example.php
    api/
    database/
    storage/
```

The ZIP intentionally does not include `config.php`; create it from `config.example.php` after extraction. Keep the supplied `.htaccess` files in place. Do not move `cpanel/storage/` into a public URL. Ensure PHP can write to `cpanel/storage/` while keeping the directory inaccessible over HTTP.

## 6. Check the API and frontend

Visit:

```text
https://YOUR-DOMAIN/api/health
```

The expected response is:

```json
{"ok":true,"database":"mysql"}
```

Then open the site and create an initial account. Email delivery is disabled by default, so signup does not send a verification link until SMTP is configured and enabled by an administrator.

## 7. Create the first administrator

1. Register the intended administrator account through the site while email delivery is disabled.
2. In phpMyAdmin or another private, trusted database session, promote that exact account:

```sql
UPDATE users
SET role = 'admin'
WHERE email = 'admin@your-domain.example';
```

3. Confirm the correct account was updated:

```sql
SELECT id, email, role
FROM users
WHERE email = 'admin@your-domain.example';
```

Use the real email address in both queries and verify the row before proceeding. Never add a public endpoint for changing account roles. Sign in, configure SMTP, and enable email delivery. The administrator must then verify their email before using admin APIs; on the first login, enroll and verify an authenticator as well.

## 8. Configure email delivery

Configure SMTP in **Admin → Email & templates** and enable the email toggle only after the settings are saved. The private SMTP settings in `config.php` may supply transport credentials but do not override the Admin toggle. Test delivery before relying on verification, password reset, or queued notifications. While email is disabled, signup and sign-in do not require verification, password-reset messages are not sent, and queued notifications are held. Once enabled, unverified users must verify before signing in; the next login sends a fresh verification link. Existing unverified sessions are also blocked until verification. Verification and password-reset links use `app.base_url`, which must match the deployed HTTPS domain.

For unattended queue processing:

1. Keep a random `email_queue_secret` of at least 32 characters in `config.php`.
2. In cPanel **Cron Jobs**, schedule a POST to `https://YOUR-DOMAIN/api/functions/admin-email` with JSON body `{"action":"process_queue"}` and the `X-Email-Queue-Secret` header.
3. Keep the secret out of public files and logs. The secret authorizes queue processing only.

## 9. Optional payment and task-partner setup

For online payments, add the provider credentials to `config.php` and configure these HTTPS webhook URLs in the provider dashboards:

```text
https://YOUR-DOMAIN/api/payments/webhook/paystack
https://YOUR-DOMAIN/api/payments/webhook/flutterwave
```

For automatic task verification, set a private `task_verification.secret` and share it only with trusted partners. Partners must HMAC-SHA256 the exact JSON request body and send the hex digest in `x-task-verification-signature` to:

```text
https://YOUR-DOMAIN/api/task-verification/complete
```

## 10. Production checks and maintenance

Before accepting real users or payments, test email delivery, storage uploads, administrator MFA, wallet transactions, payment webhooks, and the task-partner callback on the deployed HTTPS site. Back up both the MySQL database and `cpanel/storage/` regularly. Do not remove the storage protection file or expose private proof uploads as public files.

### Common deployment errors

- **Health endpoint returns 503:** `cpanel/config.php` is missing or PHP cannot read it.
- **Health endpoint returns a database error:** verify the cPanel database host, prefixed database name/user, password, and user privileges.
- **Frontend routes work but `/api/*` returns 404:** restore the supplied document-root `.htaccess` and confirm Apache rewriting is enabled.
- **Verification links use the wrong domain:** correct `app.base_url` in `cpanel/config.php`.

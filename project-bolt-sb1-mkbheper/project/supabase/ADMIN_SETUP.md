# Admin Console Setup

## Deploy the database changes

Apply all migrations in `supabase/migrations` to the Supabase project before using the admin console. The wallet-only task visibility and plan-lock behavior is added by `20261102230000_wallet_only_locked_task_catalog.sql`.

For local development, provide `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vite environment. A variable-name template is available in `.env.example`. The anon key is intended for browser use with RLS enabled; never put the service-role key in a `VITE_` variable. Without these values, the public landing page remains available but authentication and dashboard data are disabled.

Member task claims, withdrawal requests, task reviews, payouts, account status changes, and wallet adjustments use database functions or admin-only RLS policies. Daily task limits are enforced in the task-claim function. Do not restore direct client write permissions to balances, task completions, or withdrawals.

## Deploy login history capture

Deploy the authenticated Edge Function after applying the schema migration:

```sh
supabase functions deploy capture-login
```

The function validates the caller's access token and writes the platform-provided IP address and user-agent through the service role. Keep `SUPABASE_SERVICE_ROLE_KEY` in the Edge Function secret store only; never expose it to Vite. Login history does not perform IP geolocation.

## Automatic task verification

`complete-task-verification` is deployed with gateway JWT verification disabled because partner servers authenticate callbacks using HMAC. Configure a strong random `TASK_VERIFICATION_SECRET` in Supabase Function secrets and share it only with trusted campaign partners:

```sh
supabase secrets set TASK_VERIFICATION_SECRET=<strong-random-secret>
```

Deploy with `supabase functions deploy complete-task-verification --no-verify-jwt`. Partners must HMAC-SHA256 the exact JSON request body and send the hex digest in `x-task-verification-signature`. The body is `{"tracking_id":"<id from task URL>","provider_reference":"<partner event id>"}`. Automatic tasks create a one-hour tracking session; the callback validates funding, plan, limits, and session state before crediting. Never switch a campaign to automatic mode without a real partner callback and secret configured. Manual mode requires proof and admin review.

Paid plan upgrades use `purchase_plan_with_wallet`, which atomically debits the member's selected reward and/or referral balances and activates the subscription. No external checkout or gateway secret is used. Admin wallet credits/debits are audited through the admin wallet control.

## SMTP notifications

Apply `20261111110000_email_notifications.sql` and deploy the admin email function:

```sh
supabase secrets set SMTP_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32)" EMAIL_QUEUE_SECRET="$(openssl rand -hex 32)"
supabase functions deploy admin-email
```

Keep both secrets stable and server-side. Rotating `SMTP_CONFIG_ENCRYPTION_KEY` makes the saved SMTP password unreadable, so re-enter the password in Admin Console → Email & templates after rotation. The SMTP password is encrypted by the Edge Function before it is saved; it is never exposed to Vite or returned to the browser. Configure the SMTP host, port, TLS, username, sender, and password in that admin section, then send a test email.

Referral signups and first hustles, hustle approvals/rejections, withdrawal requests/results, funding submissions/results, plan activation, and admin wallet adjustments are written to the email queue. The admin panel can process it manually. To send automatically, schedule a trusted server job to POST `{"action":"process_queue"}` to `/functions/v1/admin-email` with `x-email-queue-secret: <EMAIL_QUEUE_SECRET>` every minute. Never put this secret or SMTP credentials in a `VITE_` variable. Queue processing retries failed messages up to five times.

## Provision an administrator

Admins are identified by the `role: "admin"` claim in Supabase Auth `app_metadata`. Assign it only from a trusted server or private operator environment using the Supabase Admin API:

```ts
const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
  app_metadata: { role: 'admin', mfa_required: true },
});
```

`supabaseAdmin` must use a service-role key and must never be imported into this Vite application, exposed through a `VITE_` variable, or sent to a browser. Do not use user-editable `user_metadata` for authorization. After provisioning, the administrator should sign out and back in so the new claim is present in their access token.

The console is available at `/admin/login`. Setting `mfa_required: true` enables authenticator-app TOTP enrollment and verification; the database also requires the Supabase JWT assurance claim `aal2` for admin RLS/RPC access. The route check is for user experience only; Postgres RLS and the security-definer RPC checks are the authorization boundary.

## Referral copy and email notifications

The four `referrals.how_it_works.*` site-content entries are shared by the public referral section and the signed-in Referral page. Edit them in Admin Console → CMS & media → Site copy.

The `20261111110000_email_notifications.sql` migration seeds editable notification templates and queues messages for referral signups/first hustles, hustle approvals/rejections, withdrawal requests/results, funding submissions/results, plan activation, and admin wallet adjustments. SMTP credentials are managed in Admin Console → Email & templates. The SMTP password is encrypted by the `admin-email` Edge Function using a server-only key; it is never returned to the browser or stored in plaintext.

Generate and set the encryption key and separate scheduled-worker secret once. Keep both values private and stable; rotating the encryption key requires re-entering the SMTP password:

```sh
supabase secrets set SMTP_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32)" EMAIL_QUEUE_SECRET="$(openssl rand -hex 32)"
supabase functions deploy admin-email
```

After saving SMTP settings, use **Send test email** in the admin panel. Database events are queued immediately. The panel can process pending messages manually; for unattended delivery, configure a trusted scheduler to POST once per minute to `https://<project-ref>.supabase.co/functions/v1/admin-email` with `x-email-queue-secret: <EMAIL_QUEUE_SECRET>`, `Content-Type: application/json`, and body `{"action":"process_queue"}`. Never expose the queue secret or SMTP credentials in a `VITE_` variable. The queue retries failed messages up to five times and records the last delivery error for admin review.

## Current scope and production requirements

The console supports task CRUD and quotas, active/suspended/banned user status, audited wallet adjustments, task-submission review, private screenshot proofs, manual withdrawal decisions, payout minimum/window settings, CMS copy and public media, plan configuration, admin audit history, and login history. CMS hero copy is read by the public homepage. A payout is debited from the wallet only when an administrator marks it paid with a transaction reference. The media bucket accepts public images up to 10 MB; uploads are admin-only. Members can opt in to show a masked label with real paid withdrawals in the public ticker.

Tasks can use manual review or automatic partner verification. Manual review requires proof text or a screenshot and remains in the admin review queue. Automatic tasks create a one-hour, one-time `tracking_id` session and append it to the task URL as a query parameter. A trusted partner backend must call `complete-task-verification` after it independently verifies the action. Configure `TASK_VERIFICATION_SECRET` only in Supabase Function secrets; sign the exact raw JSON body with HMAC-SHA256 and send the hex digest in `x-task-verification-signature`. The JSON body contains `tracking_id` and optional `provider_reference`. A click or redirect by itself never credits a reward. Telegram/WhatsApp/social providers still need their own authorized membership or campaign integration.

Free, Premium, and VIP plans have server-enforced task and earning caps. Payout windows queue eligible requests for manual review; automatic scheduled bank transfers still require a transfer provider, bank-account resolution, and a trusted scheduler. Telegram/social membership APIs need authorized partner credentials and linked user identity; public WhatsApp APIs do not expose reliable group membership checks. Telegram delivery, IP geolocation, and device fingerprinting are not included. Do not rely on covert browser fingerprinting; use explicit, privacy-reviewed device enrollment. Keep provider credentials in server-side secret stores.

The catalog seeds 50 visible templates each for Telegram joins, WhatsApp group joins, surveys, and social media engagements. Their reward ladder is ₦50 for slots 1–10, then ₦100/₦200/₦300/₦500 for each following block of ten. All 200 templates are unfunded and cannot be claimed until an admin configures the partner link, verification, eligibility, and real campaign budget. Premium/VIP tasks remain visible and show a plan lock to members on lower tiers. The payout ticker intentionally shows no fabricated activity when there are no opted-in paid withdrawals.
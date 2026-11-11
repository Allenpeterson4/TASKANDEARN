INSERT INTO public.site_content (content_key, title, body)
VALUES
  ('referrals.how_it_works.1', 'Referral steps - 1', 'Copy and share your unique referral link via WhatsApp, social media, or anywhere.'),
  ('referrals.how_it_works.2', 'Referral steps - 2', 'Your friend signs up using your link and creates a verified account.'),
  ('referrals.how_it_works.3', 'Referral steps - 3', 'When they complete their first hustle, you receive the configured referral bonus.'),
  ('referrals.how_it_works.4', 'Referral steps - 4', 'You continue earning referral rewards as your invite completes hustles.')
ON CONFLICT (content_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_smtp_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  host text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 587 CHECK (port BETWEEN 1 AND 65535),
  secure boolean NOT NULL DEFAULT false,
  username text NOT NULL DEFAULT '',
  from_email text NOT NULL DEFAULT '',
  from_name text NOT NULL DEFAULT 'MrHustler',
  password_ciphertext text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.email_smtp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_smtp_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_smtp_settings TO service_role;
INSERT INTO public.email_smtp_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_notification_templates (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[a-z0-9_]{2,80}$'),
  title text NOT NULL,
  subject_template text NOT NULL CHECK (length(subject_template) BETWEEN 1 AND 200),
  body_template text NOT NULL CHECK (length(body_template) BETWEEN 1 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  available_variables text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.email_notification_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_notification_templates TO authenticated;
DROP POLICY IF EXISTS admins_manage_email_templates ON public.email_notification_templates;
CREATE POLICY admins_manage_email_templates ON public.email_notification_templates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.email_notification_templates (event_key, title, subject_template, body_template, available_variables) VALUES
  ('referral_registered', 'New referral signup', 'A friend joined with your referral link', 'Hi {{first_name}},\n\n{{referred_name}} joined using your referral link on {{event_date}}.\n\nKeep sharing your link to grow your referral rewards.', ARRAY['first_name','referred_name','event_date']),
  ('referral_first_hustle', 'Referral completed first hustle', 'Your referral completed their first hustle', 'Hi {{first_name}},\n\n{{referred_name}} completed their first hustle. Your referral bonus is {{bonus_status}}.\n\nThank you for growing the community.', ARRAY['first_name','referred_name','bonus_status']),
  ('hustle_approved', 'Hustle approved', 'Your hustle was approved', 'Hi {{first_name}},\n\nYour submission for {{task_title}} was approved. {{reward_message}}', ARRAY['first_name','task_title','reward_message']),
  ('hustle_rejected', 'Hustle needs attention', 'Update on your hustle submission', 'Hi {{first_name}},\n\nYour submission for {{task_title}} was not approved. Review note: {{review_note}}', ARRAY['first_name','task_title','review_note']),
  ('withdrawal_requested', 'Withdrawal requested', 'We received your withdrawal request', 'Hi {{first_name}},\n\nYour request to withdraw {{amount}} from your {{wallet_type}} wallet was received on {{event_date}}. Status: {{status}}.', ARRAY['first_name','amount','wallet_type','event_date','status']),
  ('withdrawal_paid', 'Withdrawal paid', 'Your withdrawal has been paid', 'Hi {{first_name}},\n\nYour withdrawal of {{amount}} was marked paid. Reference: {{reference}}.', ARRAY['first_name','amount','reference']),
  ('withdrawal_rejected', 'Withdrawal update', 'Your withdrawal request was not approved', 'Hi {{first_name}},\n\nYour withdrawal of {{amount}} was rejected. Note: {{review_note}}', ARRAY['first_name','amount','review_note']),
  ('funding_submitted', 'Funding submitted', 'We received your wallet funding submission', 'Hi {{first_name}},\n\nYour funding submission for {{amount}} via {{payment_method}} is under review.', ARRAY['first_name','amount','payment_method']),
  ('funding_confirmed', 'Funding confirmed', 'Your wallet funding was confirmed', 'Hi {{first_name}},\n\nYour wallet funding of {{amount}} was confirmed.', ARRAY['first_name','amount']),
  ('funding_rejected', 'Funding update', 'Your wallet funding needs attention', 'Hi {{first_name}},\n\nYour funding submission for {{amount}} was rejected. Note: {{review_note}}', ARRAY['first_name','amount','review_note']),
  ('subscription_activated', 'Plan activated', 'Your {{plan_name}} plan is active', 'Hi {{first_name}},\n\nYour {{plan_name}} plan was activated on {{event_date}}.', ARRAY['first_name','plan_name','event_date']),
  ('wallet_adjusted', 'Wallet activity', 'An adjustment was made to your {{wallet_type}} wallet', 'Hi {{first_name}},\n\nAn administrator recorded {{amount}} on your {{wallet_type}} wallet. Reason: {{reason}}', ARRAY['first_name','amount','wallet_type','reason'])
ON CONFLICT (event_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_notification_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_notification_queue_pending_idx
  ON public.email_notification_queue (created_at) WHERE status IN ('pending', 'failed');
ALTER TABLE public.email_notification_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_notification_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_notification_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.email_notification_queue_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_email_notification(p_user_id uuid, p_event_key text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.email_notification_queue (user_id, event_key, payload)
  VALUES (p_user_id, p_event_key, COALESCE(p_payload, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_email_notification(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_referral_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), username, 'Your friend') INTO v_name
  FROM public.profiles WHERE user_id = NEW.referred_id;
  PERFORM public.enqueue_email_notification(NEW.referrer_id, 'referral_registered', jsonb_build_object(
    'referred_name', COALESCE(v_name, 'Your friend'), 'event_date', to_char(NEW.created_at, 'YYYY-MM-DD')
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_referral_signup_email ON public.referrals;
CREATE TRIGGER queue_referral_signup_email AFTER INSERT ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.queue_referral_email();

CREATE OR REPLACE FUNCTION public.queue_task_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_title text;
  v_reward numeric(12,2);
  v_referrer_id uuid;
  v_approved_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;

  SELECT title, reward INTO v_task_title, v_reward FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.status = 'approved' THEN
    PERFORM public.enqueue_email_notification(NEW.user_id, 'hustle_approved', jsonb_build_object(
      'task_title', COALESCE(v_task_title, 'Hustle'), 'reward_message', 'Reward: ' || COALESCE(v_reward, 0)::text
    ));
    SELECT referrer_id INTO v_referrer_id FROM public.referrals WHERE referred_id = NEW.user_id;
    IF v_referrer_id IS NOT NULL THEN
      SELECT count(*) INTO v_approved_count FROM public.task_completions WHERE user_id = NEW.user_id AND status = 'approved';
      IF v_approved_count = 1 THEN
        PERFORM public.enqueue_email_notification(v_referrer_id, 'referral_first_hustle', jsonb_build_object(
          'referred_name', COALESCE((SELECT NULLIF(full_name, '') FROM public.profiles WHERE user_id = NEW.user_id), 'Your referral'),
          'bonus_status', CASE WHEN EXISTS (SELECT 1 FROM public.balances WHERE user_id = v_referrer_id AND referral_balance > 0) THEN 'credited' ELSE 'being processed' END
        ));
      END IF;
    END IF;
  ELSE
    PERFORM public.enqueue_email_notification(NEW.user_id, 'hustle_rejected', jsonb_build_object(
      'task_title', COALESCE(v_task_title, 'Hustle'), 'review_note', COALESCE(NEW.review_note, 'Please review the submission requirements.')
    ));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_task_review_email ON public.task_completions;
CREATE TRIGGER queue_task_review_email AFTER INSERT OR UPDATE OF status ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.queue_task_email();

CREATE OR REPLACE FUNCTION public.queue_withdrawal_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_email_notification(NEW.user_id, 'withdrawal_requested', jsonb_build_object(
      'amount', NEW.amount::text, 'wallet_type', COALESCE(NEW.wallet_type, 'hustler'), 'status', NEW.status, 'event_date', to_char(NEW.requested_at, 'YYYY-MM-DD')
    ));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' THEN
      PERFORM public.enqueue_email_notification(NEW.user_id, 'withdrawal_paid', jsonb_build_object('amount', NEW.amount::text, 'reference', COALESCE(NEW.transaction_reference, 'Not provided')));
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.enqueue_email_notification(NEW.user_id, 'withdrawal_rejected', jsonb_build_object('amount', NEW.amount::text, 'review_note', COALESCE(NEW.review_note, 'Contact support for details.')));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_withdrawal_email ON public.withdrawals;
CREATE TRIGGER queue_withdrawal_email AFTER INSERT OR UPDATE OF status ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION public.queue_withdrawal_email();

CREATE OR REPLACE FUNCTION public.queue_funding_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_email_notification(NEW.user_id, 'funding_submitted', jsonb_build_object('amount', NEW.amount::text, 'payment_method', NEW.payment_method));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' THEN
      PERFORM public.enqueue_email_notification(NEW.user_id, 'funding_confirmed', jsonb_build_object('amount', NEW.amount::text));
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.enqueue_email_notification(NEW.user_id, 'funding_rejected', jsonb_build_object('amount', NEW.amount::text, 'review_note', COALESCE(NEW.review_note, 'Contact support for details.')));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_funding_email ON public.funding_deposits;
CREATE TRIGGER queue_funding_email AFTER INSERT OR UPDATE OF status ON public.funding_deposits
FOR EACH ROW EXECUTE FUNCTION public.queue_funding_email();

CREATE OR REPLACE FUNCTION public.queue_subscription_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_name text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;
  SELECT name INTO v_plan_name FROM public.subscription_plans WHERE plan_code = NEW.plan_code;
  PERFORM public.enqueue_email_notification(NEW.user_id, 'subscription_activated', jsonb_build_object(
    'plan_name', COALESCE(v_plan_name, NEW.plan_code), 'event_date', to_char(now(), 'YYYY-MM-DD')
  ));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_subscription_email ON public.user_subscriptions;
CREATE TRIGGER queue_subscription_email AFTER INSERT OR UPDATE OF status ON public.user_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.queue_subscription_email();

CREATE OR REPLACE FUNCTION public.queue_wallet_adjustment_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL AND NEW.actor_id <> NEW.user_id AND public.is_admin() THEN
    PERFORM public.enqueue_email_notification(NEW.user_id, 'wallet_adjusted', jsonb_build_object(
      'amount', NEW.amount::text, 'wallet_type', NEW.balance_type, 'reason', NEW.reason
    ));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_wallet_adjustment_email ON public.wallet_ledger;
CREATE TRIGGER queue_wallet_adjustment_email AFTER INSERT ON public.wallet_ledger
FOR EACH ROW EXECUTE FUNCTION public.queue_wallet_adjustment_email();

CREATE OR REPLACE FUNCTION public.admin_email_queue_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  RETURN jsonb_build_object(
    'pending', (SELECT count(*) FROM public.email_notification_queue WHERE status = 'pending'),
    'failed', (SELECT count(*) FROM public.email_notification_queue WHERE status = 'failed'),
    'sent', (SELECT count(*) FROM public.email_notification_queue WHERE status = 'sent')
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_email_queue_stats() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_email_queue_stats() FROM PUBLIC, anon;
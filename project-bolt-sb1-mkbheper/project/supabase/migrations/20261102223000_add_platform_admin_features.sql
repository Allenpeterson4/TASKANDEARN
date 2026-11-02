CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
    AND (
      auth.jwt() -> 'app_metadata' ->> 'mfa_required' IS DISTINCT FROM 'true'
      OR auth.jwt() ->> 'aal' = 'aal2'
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_account_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_status_check
      CHECK (account_status IN ('active', 'suspended', 'banned')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS public_activity_opt_in boolean NOT NULL DEFAULT false;

GRANT UPDATE (public_activity_opt_in) ON public.profiles TO authenticated;
GRANT UPDATE (avatar_url) ON public.profiles TO authenticated;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

REVOKE INSERT ON public.referrals FROM authenticated;
DROP POLICY IF EXISTS "insert_own_referrals" ON public.referrals;

CREATE OR REPLACE FUNCTION public.initialize_rewardpeak_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referral_code text;
  v_referrer_id uuid;
BEGIN
  LOOP
    v_referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_referral_code);
  END LOOP;

  INSERT INTO public.profiles (user_id, username, full_name, phone, tier, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'member'),
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'phone', ''),
    'Bronze',
    v_referral_code
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.balances (user_id, reward_balance, referral_balance, total_earned)
  VALUES (NEW.id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT user_id INTO v_referrer_id
  FROM public.profiles
  WHERE referral_code = upper(btrim(COALESCE(NEW.raw_user_meta_data ->> 'referral_code', '')))
    AND user_id <> NEW.id;

  IF v_referrer_id IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (v_referrer_id, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_rewardpeak_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_rewardpeak_created ON auth.users;
CREATE TRIGGER on_auth_user_rewardpeak_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.initialize_rewardpeak_user();

CREATE TABLE IF NOT EXISTS public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_activity_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_activity_log TO authenticated;
CREATE POLICY "admin_read_activity_log" ON public.admin_activity_log FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.user_login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address text,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_login_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_login_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_login_history TO authenticated;
CREATE POLICY "admin_read_login_history" ON public.user_login_history FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS user_login_history_user_time_idx
  ON public.user_login_history (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_wallet_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
  VALUES (
    NEW.actor_id, NEW.user_id, 'wallet_adjustment',
    jsonb_build_object(
      'balance_type', NEW.balance_type,
      'amount', NEW.amount,
      'reason', NEW.reason,
      'ledger_id', NEW.id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_wallet_ledger_insert
  AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.audit_wallet_ledger_insert();

CREATE OR REPLACE FUNCTION public.audit_task_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at AND NEW.reviewed_by IS NOT NULL THEN
    INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
    VALUES (
      NEW.reviewed_by, NEW.user_id, 'task_submission_reviewed',
      jsonb_build_object('completion_id', NEW.id, 'task_id', NEW.task_id, 'status', NEW.status, 'note', NEW.review_note)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_task_review
  AFTER UPDATE ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.audit_task_review();

CREATE OR REPLACE FUNCTION public.audit_withdrawal_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.processed_by IS NOT NULL THEN
    INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
    VALUES (
      NEW.processed_by, NEW.user_id, 'withdrawal_reviewed',
      jsonb_build_object('withdrawal_id', NEW.id, 'status', NEW.status, 'amount', NEW.amount, 'reference', NEW.transaction_reference)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_withdrawal_review
  AFTER UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.audit_withdrawal_review();

CREATE OR REPLACE FUNCTION public.audit_task_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.is_admin() THEN
      INSERT INTO public.admin_activity_log (actor_id, action, details)
      VALUES (
        auth.uid(), 'task_catalog_delete',
        jsonb_build_object('task_id', OLD.id, 'title', OLD.title)
      );
    END IF;
    RETURN OLD;
  END IF;

  IF public.is_admin() THEN
    INSERT INTO public.admin_activity_log (actor_id, action, details)
    VALUES (
      auth.uid(), 'task_catalog_' || lower(TG_OP),
      jsonb_build_object('task_id', NEW.id, 'title', NEW.title)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_task_catalog_change
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_task_catalog_change();

CREATE OR REPLACE FUNCTION public.admin_set_user_status(
  p_user_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'banned') THEN
    RAISE EXCEPTION 'Invalid account status';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own account status';
  END IF;
  IF length(COALESCE(p_reason, '')) > 500 THEN
    RAISE EXCEPTION 'Reason must be 500 characters or fewer';
  END IF;

  SELECT account_status INTO v_old_status
  FROM public.profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  UPDATE public.profiles
  SET account_status = p_status,
      status_reason = NULLIF(btrim(p_reason), ''),
      status_changed_at = now(),
      status_changed_by = auth.uid()
  WHERE user_id = p_user_id;

  INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
  VALUES (
    auth.uid(), p_user_id, 'user_status_changed',
    jsonb_build_object('from', v_old_status, 'to', p_status, 'reason', NULLIF(btrim(p_reason), ''))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_shuffle_tasks(p_category text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH randomized AS (
    SELECT id, row_number() OVER (ORDER BY random())::integer AS position
    FROM public.tasks
    WHERE p_category IS NULL OR category = p_category
  )
  UPDATE public.tasks AS task
  SET sort_order = randomized.position
  FROM randomized
  WHERE task.id = randomized.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_activity_log (actor_id, action, details)
  VALUES (auth.uid(), 'task_catalog_shuffled', jsonb_build_object('category', p_category, 'count', v_count));
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_shuffle_tasks(text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_shuffle_tasks(text) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.site_content (
  content_key text PRIMARY KEY CHECK (content_key ~ '^[a-z0-9._-]{1,100}$'),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.site_content TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.site_content TO authenticated;
CREATE POLICY "public_read_site_content" ON public.site_content FOR SELECT
  TO anon, authenticated USING (true);
CREATE POLICY "admin_manage_site_content" ON public.site_content FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.site_content (content_key, title, body) VALUES
  ('home.hero.title', 'Hero headline', E'Turn Every\nTask into\nReal Naira'),
  ('home.hero.description', 'Hero description', 'Join thousands of Nigerians earning significant rewards daily by completing simple tasks, surveys, and referring friends. Your hustle, your earnings, paid directly to your bank account.'),
  ('home.offer.banner', 'Welcome bonus', 'Complete your first task to unlock your new member reward.'),
  ('support.contact', 'Support contact', 'Contact support through the in-app support section.')
ON CONFLICT (content_key) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('site-media', 'site-media', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "public_read_site_media" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'site-media');
CREATE POLICY "admin_manage_site_media" ON storage.objects FOR ALL
  TO authenticated USING (bucket_id = 'site-media' AND public.is_admin())
  WITH CHECK (bucket_id = 'site-media' AND public.is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('member-avatars', 'member-avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE POLICY "public_read_member_avatars" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'member-avatars');
CREATE POLICY "members_manage_own_avatar" ON storage.objects FOR ALL
  TO authenticated USING (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  ) WITH CHECK (
    bucket_id = 'member-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

ALTER TABLE public.task_completions
  ADD COLUMN IF NOT EXISTS proof_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('task-proofs', 'task-proofs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "member_upload_own_task_proof" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'task-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "admin_read_task_proofs" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'task-proofs' AND public.is_admin());

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  plan_code text PRIMARY KEY CHECK (plan_code ~ '^[a-z0-9_-]{1,40}$'),
  name text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  daily_task_limit integer NOT NULL CHECK (daily_task_limit > 0),
  daily_earning_cap numeric(12,2) CHECK (daily_earning_cap IS NULL OR daily_earning_cap >= 0),
  referral_commission_percent numeric(5,2) NOT NULL CHECK (referral_commission_percent BETWEEN 0 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.subscription_plans TO authenticated;
CREATE POLICY "public_read_active_plans" ON public.subscription_plans FOR SELECT
  TO anon USING (is_active);
CREATE POLICY "authenticated_read_plans" ON public.subscription_plans FOR SELECT
  TO authenticated USING (is_active OR public.is_admin());
CREATE POLICY "admin_manage_plans" ON public.subscription_plans FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.subscription_plans (plan_code, name, price, daily_task_limit, daily_earning_cap, referral_commission_percent)
VALUES
  ('free', 'Free', 0, 30, 4000, 5),
  ('premium', 'Premium', 5000, 100, 20000, 10),
  ('vip', 'VIP', 15000, 2147483647, NULL, 15)
ON CONFLICT (plan_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.subscription_plans(plan_code),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  provider text,
  provider_reference text UNIQUE,
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  wallet_contribution numeric(12,2) NOT NULL DEFAULT 0 CHECK (wallet_contribution >= 0),
  expires_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_subscriptions TO authenticated;
CREATE POLICY "members_read_own_subscriptions" ON public.user_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admin_read_subscriptions" ON public.user_subscriptions FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.reserve_plan_upgrade(
  p_plan_code text,
  p_wallet_contribution numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_balance numeric(12,2);
  v_pending_withdrawals numeric(12,2);
  v_reserved_subscriptions numeric(12,2);
  v_reference text;
  v_subscription_id uuid;
  v_external_amount numeric(12,2);
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM 1 FROM public.profiles
  WHERE user_id = auth.uid() AND account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans
  WHERE plan_code = p_plan_code AND is_active AND price > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paid plan is unavailable';
  END IF;
  IF p_wallet_contribution < 0 OR p_wallet_contribution > v_plan.price THEN
    RAISE EXCEPTION 'Wallet contribution is outside the plan price';
  END IF;
  IF p_wallet_contribution IS NULL OR round(p_wallet_contribution, 2) <> p_wallet_contribution THEN
    RAISE EXCEPTION 'Wallet contribution must use two decimal places or fewer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_subscriptions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (ends_at IS NULL OR ends_at > v_now)
  ) THEN
    RAISE EXCEPTION 'An active paid plan already exists';
  END IF;

  UPDATE public.user_subscriptions
  SET status = 'expired'
  WHERE user_id = auth.uid()
    AND status = 'pending'
    AND expires_at <= v_now;

  IF EXISTS (
    SELECT 1 FROM public.user_subscriptions
    WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'A plan checkout is already in progress';
  END IF;

  SELECT reward_balance INTO v_balance
  FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_pending_withdrawals
  FROM public.withdrawals WHERE user_id = auth.uid() AND status = 'pending';
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved_subscriptions
  FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > v_now;
  IF v_balance - v_pending_withdrawals - v_reserved_subscriptions < p_wallet_contribution THEN
    RAISE EXCEPTION 'Insufficient available reward balance';
  END IF;

  v_reference := 'RP_' || replace(gen_random_uuid()::text, '-', '');
  v_external_amount := v_plan.price - p_wallet_contribution;

  IF v_external_amount = 0 THEN
    UPDATE public.balances
    SET reward_balance = reward_balance - p_wallet_contribution,
        updated_at = v_now
    WHERE user_id = auth.uid();
    INSERT INTO public.user_subscriptions (
      user_id, plan_code, status, provider, provider_reference, amount,
      wallet_contribution, starts_at, ends_at
    ) VALUES (
      auth.uid(), p_plan_code, 'active', 'wallet', v_reference, v_plan.price,
      p_wallet_contribution, v_now, v_now + interval '30 days'
    ) RETURNING id INTO v_subscription_id;

    INSERT INTO public.wallet_ledger (
      user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
    ) VALUES (
      auth.uid(), auth.uid(), 'reward', -p_wallet_contribution, v_balance,
      v_balance - p_wallet_contribution, 'Wallet-funded plan ' || p_plan_code
    );

    RETURN jsonb_build_object('status', 'active', 'subscription_id', v_subscription_id, 'external_amount', 0);
  END IF;

  INSERT INTO public.user_subscriptions (
    user_id, plan_code, status, provider, provider_reference, amount,
    wallet_contribution, expires_at
  ) VALUES (
    auth.uid(), p_plan_code, 'pending', 'paystack', v_reference, v_plan.price,
    p_wallet_contribution, v_now + interval '30 minutes'
  ) RETURNING id INTO v_subscription_id;

  RETURN jsonb_build_object(
    'status', 'pending',
    'subscription_id', v_subscription_id,
    'reference', v_reference,
    'external_amount', v_external_amount,
    'wallet_contribution', p_wallet_contribution
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_plan_upgrade(text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_plan_upgrade(text, numeric) FROM PUBLIC, anon;

DROP FUNCTION IF EXISTS public.claim_task(uuid, text);

CREATE FUNCTION public.claim_task(
  p_task_id uuid,
  p_proof_text text DEFAULT NULL,
  p_proof_path text DEFAULT NULL
)
RETURNS public.task_completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_completion public.task_completions%ROWTYPE;
  v_daily_count integer;
  v_daily_limit integer;
  v_daily_earning_cap numeric(12,2);
  v_daily_earned numeric(12,2);
  v_plan_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM 1 FROM public.profiles
  WHERE user_id = auth.uid() AND account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
    AND is_active
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task is unavailable';
  END IF;

  IF v_task.proof_required
    AND length(btrim(COALESCE(p_proof_text, ''))) = 0
    AND p_proof_path IS NULL THEN
    RAISE EXCEPTION 'Proof is required for this task';
  END IF;
  IF length(COALESCE(p_proof_text, '')) > 2000 THEN
    RAISE EXCEPTION 'Proof must be 2000 characters or fewer';
  END IF;
  IF p_proof_path IS NOT NULL THEN
    IF p_proof_path NOT LIKE (auth.uid()::text || '/%') OR length(p_proof_path) > 500 THEN
      RAISE EXCEPTION 'Invalid proof upload path';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'task-proofs' AND name = p_proof_path
    ) THEN
      RAISE EXCEPTION 'Proof upload was not found';
    END IF;
  END IF;

  SELECT plan_code INTO v_plan_code
  FROM public.user_subscriptions
  WHERE user_id = auth.uid()
    AND status = 'active'
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_plan_code IS NULL THEN
    v_plan_code := 'free';
  END IF;

  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap
  FROM public.subscription_plans
  WHERE plan_code = v_plan_code AND is_active;
  IF v_daily_limit IS NULL THEN
    RAISE EXCEPTION 'No active subscription plan is available';
  END IF;

  SELECT count(*) INTO v_daily_count
  FROM public.task_completions
  WHERE user_id = auth.uid()
    AND status IN ('pending', 'approved')
    AND completed_at >= date_trunc('day', now());
  IF v_daily_count >= v_daily_limit THEN
    RAISE EXCEPTION 'You have reached the daily task limit for your plan';
  END IF;

  IF v_daily_earning_cap IS NOT NULL THEN
    SELECT COALESCE(sum(t.reward), 0) INTO v_daily_earned
    FROM public.task_completions AS completion
    JOIN public.tasks AS t ON t.id = completion.task_id
    WHERE completion.user_id = auth.uid()
      AND completion.status IN ('pending', 'approved')
      AND completion.completed_at >= date_trunc('day', now());
    IF v_daily_earned + v_task.reward > v_daily_earning_cap THEN
      RAISE EXCEPTION 'You have reached the daily earning cap for your plan';
    END IF;
  END IF;

  IF v_task.daily_quota > 0 THEN
    SELECT count(*) INTO v_daily_count
    FROM public.task_completions
    WHERE task_id = p_task_id
      AND status IN ('pending', 'approved')
      AND completed_at >= date_trunc('day', now());
    IF v_daily_count >= v_task.daily_quota THEN
      RAISE EXCEPTION 'The daily quota for this task has been reached';
    END IF;
  END IF;

  SELECT * INTO v_completion
  FROM public.task_completions
  WHERE user_id = auth.uid() AND task_id = p_task_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_completion.status <> 'rejected' THEN
      RAISE EXCEPTION 'This task has already been submitted';
    END IF;

    UPDATE public.task_completions
    SET status = 'pending',
        proof_text = NULLIF(btrim(p_proof_text), ''),
        proof_path = p_proof_path,
        review_note = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        completed_at = now()
    WHERE id = v_completion.id
    RETURNING * INTO v_completion;

    RETURN v_completion;
  END IF;

  INSERT INTO public.task_completions (user_id, task_id, status, proof_text, proof_path)
  VALUES (auth.uid(), p_task_id, 'pending', NULLIF(btrim(p_proof_text), ''), p_proof_path)
  RETURNING * INTO v_completion;

  RETURN v_completion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_task(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_task(uuid, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.require_active_withdrawal_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = NEW.user_id AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_active_withdrawal_account
  BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.require_active_withdrawal_account();

CREATE TABLE IF NOT EXISTS public.payout_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  minimum_amount numeric(12,2) NOT NULL DEFAULT 5000 CHECK (minimum_amount >= 500),
  payout_days smallint[] NOT NULL DEFAULT ARRAY[5]::smallint[],
  window_start time NOT NULL DEFAULT '14:00',
  window_end time NOT NULL DEFAULT '18:00',
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.payout_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payout_settings TO authenticated;
GRANT INSERT, UPDATE ON public.payout_settings TO authenticated;
CREATE POLICY "members_read_payout_settings" ON public.payout_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "admin_manage_payout_settings" ON public.payout_settings FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.payout_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount numeric,
  p_bank_name text,
  p_account_no text,
  p_account_name text
)
RETURNS public.withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reward numeric(12,2);
  v_referral numeric(12,2);
  v_pending numeric(12,2);
  v_reserved_subscriptions numeric(12,2);
  v_minimum numeric(12,2);
  v_withdrawal public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND account_status = 'active'
  ) THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  SELECT minimum_amount INTO v_minimum FROM public.payout_settings WHERE singleton;
  IF p_amount < COALESCE(v_minimum, 5000) OR p_amount >= 10000000000 THEN
    RAISE EXCEPTION 'Withdrawal does not meet the minimum amount';
  END IF;
  IF length(btrim(COALESCE(p_bank_name, ''))) NOT BETWEEN 1 AND 100
    OR p_account_no !~ '^[0-9]{10}$'
    OR length(btrim(COALESCE(p_account_name, ''))) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Enter valid bank and account details';
  END IF;

  SELECT reward_balance, referral_balance INTO v_reward, v_referral
  FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_pending
  FROM public.withdrawals WHERE user_id = auth.uid() AND status = 'pending';
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved_subscriptions
  FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now();
  IF v_reward - v_reserved_subscriptions + v_referral - v_pending < p_amount THEN
    RAISE EXCEPTION 'Insufficient available balance';
  END IF;

  INSERT INTO public.withdrawals (user_id, amount, bank_name, account_no, account_name)
  VALUES (auth.uid(), p_amount, btrim(p_bank_name), p_account_no, btrim(p_account_name))
  RETURNING * INTO v_withdrawal;

  RETURN v_withdrawal;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_review_task_completion(
  p_completion_id uuid,
  p_status text,
  p_review_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_completion public.task_completions%ROWTYPE;
  v_reward numeric(10,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_referrer_id uuid;
  v_referral_plan_code text;
  v_commission_percent numeric(5,2);
  v_commission numeric(12,2);
  v_referral_before numeric(12,2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Review status must be approved or rejected';
  END IF;
  IF length(COALESCE(p_review_note, '')) > 500 THEN
    RAISE EXCEPTION 'Review note must be 500 characters or fewer';
  END IF;

  SELECT * INTO v_completion
  FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
  IF NOT FOUND OR v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending task submission not found';
  END IF;

  UPDATE public.task_completions
  SET status = p_status,
      review_note = NULLIF(btrim(p_review_note), ''),
      reviewed_at = now(),
      reviewed_by = auth.uid()
  WHERE id = p_completion_id;

  IF p_status = 'approved' THEN
    SELECT reward INTO v_reward FROM public.tasks WHERE id = v_completion.task_id;
    SELECT reward_balance INTO v_before
    FROM public.balances WHERE user_id = v_completion.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User balance not found';
    END IF;

    v_after := v_before + v_reward;
    IF v_after >= 10000000000 THEN
      RAISE EXCEPTION 'Reward exceeds the wallet balance limit';
    END IF;
    UPDATE public.balances
    SET reward_balance = v_after,
        total_earned = total_earned + v_reward,
        updated_at = now()
    WHERE user_id = v_completion.user_id;
    INSERT INTO public.wallet_ledger (
      user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
    ) VALUES (
      v_completion.user_id, auth.uid(), 'reward', v_reward, v_before, v_after,
      'Approved task completion ' || p_completion_id::text
    );

    SELECT referrer_id INTO v_referrer_id
    FROM public.referrals WHERE referred_id = v_completion.user_id;
    IF v_referrer_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles WHERE user_id = v_referrer_id AND account_status = 'active'
    ) THEN
      SELECT plan_code INTO v_referral_plan_code
      FROM public.user_subscriptions
      WHERE user_id = v_referrer_id
        AND status = 'active'
        AND starts_at <= now()
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY starts_at DESC
      LIMIT 1;

      SELECT referral_commission_percent INTO v_commission_percent
      FROM public.subscription_plans
      WHERE plan_code = COALESCE(v_referral_plan_code, 'free') AND is_active;
      v_commission := round(v_reward * COALESCE(v_commission_percent, 0) / 100, 2);

      IF v_commission > 0 THEN
        SELECT referral_balance INTO v_referral_before
        FROM public.balances WHERE user_id = v_referrer_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Referrer wallet not found';
        END IF;
        UPDATE public.balances
        SET referral_balance = referral_balance + v_commission,
            total_earned = total_earned + v_commission,
            updated_at = now()
        WHERE user_id = v_referrer_id;
        INSERT INTO public.wallet_ledger (
          user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
        ) VALUES (
          v_referrer_id, auth.uid(), 'referral', v_commission, v_referral_before,
          v_referral_before + v_commission,
          'Referral commission for task completion ' || p_completion_id::text
        );
      END IF;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_review_task_completion(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_task_completion(uuid, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_public_payout_feed()
RETURNS TABLE (member_label text, amount numeric, bank_name text, paid_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN NULLIF(btrim(p.full_name), '') IS NULL THEN 'Member'
      ELSE left(btrim(p.full_name), 1) || '***'
    END AS member_label,
    w.amount,
    w.bank_name,
    w.processed_at AS paid_at
  FROM public.withdrawals AS w
  JOIN public.profiles AS p ON p.user_id = w.user_id
  WHERE w.status = 'paid'
    AND w.processed_at >= now() - interval '30 days'
    AND p.public_activity_opt_in
  ORDER BY w.processed_at DESC
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_payout_feed() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_payout_feed() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.complete_plan_upgrade(p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription public.user_subscriptions%ROWTYPE;
  v_reward_balance numeric(12,2);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  SELECT * INTO v_subscription
  FROM public.user_subscriptions
  WHERE provider = 'paystack' AND provider_reference = p_reference
  FOR UPDATE;
  IF NOT FOUND OR v_subscription.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending subscription not found';
  END IF;
  IF v_subscription.expires_at IS NULL OR v_subscription.expires_at <= now() THEN
    RAISE EXCEPTION 'Subscription checkout has expired';
  END IF;

  SELECT reward_balance INTO v_reward_balance
  FROM public.balances WHERE user_id = v_subscription.user_id FOR UPDATE;
  IF NOT FOUND OR v_reward_balance < v_subscription.wallet_contribution THEN
    RAISE EXCEPTION 'Reserved wallet contribution is no longer available';
  END IF;

  IF v_subscription.wallet_contribution > 0 THEN
    UPDATE public.balances
    SET reward_balance = reward_balance - v_subscription.wallet_contribution,
        updated_at = now()
    WHERE user_id = v_subscription.user_id;

    INSERT INTO public.wallet_ledger (
      user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
    ) VALUES (
      v_subscription.user_id, v_subscription.user_id, 'reward',
      -v_subscription.wallet_contribution, v_reward_balance,
      v_reward_balance - v_subscription.wallet_contribution,
      'Wallet contribution to plan ' || v_subscription.plan_code
    );
  END IF;

  UPDATE public.user_subscriptions
  SET status = 'active',
      starts_at = now(),
      ends_at = now() + interval '30 days',
      expires_at = NULL
  WHERE id = v_subscription.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_plan_upgrade(text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_plan_upgrade(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_user_id uuid,
  p_balance_type text,
  p_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_reward numeric(12,2);
  v_referral numeric(12,2);
  v_pending_withdrawals numeric(12,2);
  v_reserved_subscriptions numeric(12,2);
  v_ledger_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_balance_type NOT IN ('reward', 'referral') THEN
    RAISE EXCEPTION 'Invalid balance type';
  END IF;
  IF p_amount = 0 OR abs(p_amount) >= 10000000000 THEN
    RAISE EXCEPTION 'Adjustment amount is out of range';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reason of 1 to 500 characters is required';
  END IF;

  SELECT reward_balance, referral_balance INTO v_reward, v_referral
  FROM public.balances WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User balance not found';
  END IF;

  v_before := CASE WHEN p_balance_type = 'reward' THEN v_reward ELSE v_referral END;
  v_after := v_before + p_amount;
  IF v_after < 0 OR v_after >= 10000000000 THEN
    RAISE EXCEPTION 'Adjustment would put the balance out of range';
  END IF;
  IF p_balance_type = 'reward' THEN
    v_reward := v_after;
  ELSE
    v_referral := v_after;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_pending_withdrawals
  FROM public.withdrawals WHERE user_id = p_user_id AND status = 'pending';
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved_subscriptions
  FROM public.user_subscriptions
  WHERE user_id = p_user_id AND status = 'pending' AND expires_at > now();
  IF v_reward + v_referral < v_pending_withdrawals + v_reserved_subscriptions THEN
    RAISE EXCEPTION 'Adjustment would leave pending withdrawals or upgrades unfunded';
  END IF;

  UPDATE public.balances
  SET reward_balance = v_reward,
      referral_balance = v_referral,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_ledger (
    user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
  ) VALUES (
    p_user_id, auth.uid(), p_balance_type, p_amount, v_before, v_after, btrim(p_reason)
  ) RETURNING id INTO v_ledger_id;
  RETURN v_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_review_withdrawal(
  p_withdrawal_id uuid,
  p_status text,
  p_transaction_reference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_withdrawal public.withdrawals%ROWTYPE;
  v_reward numeric(12,2);
  v_referral numeric(12,2);
  v_reward_debit numeric(12,2);
  v_referral_debit numeric(12,2);
  v_other_pending numeric(12,2);
  v_reserved_subscriptions numeric(12,2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_status NOT IN ('paid', 'rejected') THEN
    RAISE EXCEPTION 'Status must be paid or rejected';
  END IF;
  IF p_status = 'paid' AND length(btrim(COALESCE(p_transaction_reference, ''))) = 0 THEN
    RAISE EXCEPTION 'A transaction reference is required for payouts';
  END IF;
  IF length(COALESCE(p_transaction_reference, '')) > 150 THEN
    RAISE EXCEPTION 'Transaction reference must be 150 characters or fewer';
  END IF;

  SELECT * INTO v_withdrawal
  FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR v_withdrawal.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending withdrawal not found';
  END IF;

  IF p_status = 'paid' THEN
    SELECT reward_balance, referral_balance INTO v_reward, v_referral
    FROM public.balances WHERE user_id = v_withdrawal.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User wallet not found';
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_other_pending
    FROM public.withdrawals
    WHERE user_id = v_withdrawal.user_id AND status = 'pending' AND id <> p_withdrawal_id;
    SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved_subscriptions
    FROM public.user_subscriptions
    WHERE user_id = v_withdrawal.user_id AND status = 'pending' AND expires_at > now();
    IF v_reward + v_referral - v_other_pending - v_reserved_subscriptions < v_withdrawal.amount THEN
      RAISE EXCEPTION 'Wallet no longer covers this withdrawal and its existing reservations';
    END IF;

    v_reward_debit := least(v_reward, v_withdrawal.amount);
    v_referral_debit := v_withdrawal.amount - v_reward_debit;
    IF v_reward_debit > 0 THEN
      UPDATE public.balances SET reward_balance = reward_balance - v_reward_debit, updated_at = now()
      WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (v_withdrawal.user_id, auth.uid(), 'reward', -v_reward_debit, v_reward, v_reward - v_reward_debit, 'Paid withdrawal ' || p_withdrawal_id::text);
    END IF;
    IF v_referral_debit > 0 THEN
      UPDATE public.balances SET referral_balance = referral_balance - v_referral_debit, updated_at = now()
      WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (v_withdrawal.user_id, auth.uid(), 'referral', -v_referral_debit, v_referral, v_referral - v_referral_debit, 'Paid withdrawal ' || p_withdrawal_id::text);
    END IF;
  END IF;

  UPDATE public.withdrawals
  SET status = p_status,
      transaction_reference = NULLIF(btrim(p_transaction_reference), ''),
      processed_at = now(),
      processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_withdrawal(uuid, text, text) FROM PUBLIC, anon;
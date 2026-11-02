ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS verification_mode text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_verification_mode_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_verification_mode_check
      CHECK (verification_mode IN ('manual', 'automatic')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'automatic_tasks_need_link'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT automatic_tasks_need_link
      CHECK (verification_mode <> 'automatic' OR length(btrim(task_url)) > 0) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.wallet_ledger ALTER COLUMN actor_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_wallet_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.task_verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'expired')),
  provider_reference text,
  completion_id uuid UNIQUE REFERENCES public.task_completions(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS task_verification_one_started_per_user_task
  ON public.task_verification_sessions (user_id, task_id)
  WHERE status = 'started';
CREATE INDEX IF NOT EXISTS task_verification_session_expiry_idx
  ON public.task_verification_sessions (expires_at)
  WHERE status = 'started';

ALTER TABLE public.task_verification_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_verification_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_verification_sessions TO authenticated;
CREATE POLICY "members_read_own_task_sessions" ON public.task_verification_sessions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins_read_task_sessions" ON public.task_verification_sessions FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.task_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.task_verification_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('verified', 'rejected', 'expired')),
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_verification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_verification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_verification_events TO authenticated;
CREATE POLICY "admins_read_task_verification_events" ON public.task_verification_events FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.require_tracked_session_for_automatic_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.tasks WHERE id = NEW.task_id AND verification_mode = 'automatic'
  ) THEN
    RAISE EXCEPTION 'Start an automatic verification session for this task';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_tracked_session_for_automatic_task
  BEFORE INSERT ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.require_tracked_session_for_automatic_task();

CREATE OR REPLACE FUNCTION public.enforce_manual_proof_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text;
BEGIN
  SELECT verification_mode INTO v_mode FROM public.tasks WHERE id = NEW.task_id;
  IF NEW.status = 'pending' AND v_mode = 'manual'
    AND length(btrim(COALESCE(NEW.proof_text, ''))) = 0
    AND NEW.proof_path IS NULL THEN
    RAISE EXCEPTION 'Manual review requires proof text or a screenshot';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_manual_proof_submission
  BEFORE INSERT OR UPDATE OF status, proof_text, proof_path ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_proof_submission();

CREATE OR REPLACE FUNCTION public.admin_set_task_verification_mode(
  p_category text,
  p_mode text
)
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
  IF p_mode NOT IN ('manual', 'automatic') THEN
    RAISE EXCEPTION 'Invalid verification mode';
  END IF;
  IF p_mode = 'automatic' AND EXISTS (
    SELECT 1 FROM public.tasks
    WHERE (p_category IS NULL OR category = p_category)
      AND length(btrim(task_url)) = 0
  ) THEN
    RAISE EXCEPTION 'Every task in this category needs a partner link before enabling automatic verification';
  END IF;

  UPDATE public.tasks
  SET verification_mode = p_mode
  WHERE p_category IS NULL OR category = p_category;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.admin_activity_log (actor_id, action, details)
  VALUES (
    auth.uid(), 'task_verification_mode_changed',
    jsonb_build_object('category', p_category, 'mode', p_mode, 'count', v_count)
  );
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_task_verification_mode(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_task_verification_mode(text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.start_task_verification(p_task_id uuid)
RETURNS public.task_verification_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_session public.task_verification_sessions%ROWTYPE;
  v_plan_code text;
  v_user_rank integer;
  v_required_rank integer;
  v_daily_count integer;
  v_daily_limit integer;
  v_daily_earning_cap numeric(12,2);
  v_daily_earned numeric(12,2);
  v_task_count integer;
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

  SELECT * INTO v_task FROM public.tasks
  WHERE id = p_task_id AND is_active AND is_funded
    AND verification_mode = 'automatic'
    AND length(btrim(task_url)) > 0
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This task is not available for automatic tracking';
  END IF;

  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'active'
    AND starts_at <= now() AND ends_at > now()
  ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_user_rank FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_required_rank FROM public.tasks WHERE id = p_task_id;
  IF v_user_rank IS NULL OR v_user_rank < v_required_rank THEN
    RAISE EXCEPTION 'This task requires the % plan', initcap(v_task.required_plan_code);
  END IF;

  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap FROM public.subscription_plans
  WHERE plan_code = v_plan_code AND is_active;
  SELECT count(*) INTO v_daily_count FROM public.task_completions
  WHERE user_id = auth.uid() AND status IN ('pending', 'approved')
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
    SELECT count(*) INTO v_task_count FROM public.task_completions
    WHERE task_id = p_task_id AND status IN ('pending', 'approved')
      AND completed_at >= date_trunc('day', now());
    IF v_task_count >= v_task.daily_quota THEN
      RAISE EXCEPTION 'The daily quota for this task has been reached';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.task_completions
    WHERE user_id = auth.uid() AND task_id = p_task_id AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'This task has already been submitted';
  END IF;

  UPDATE public.task_verification_sessions
  SET status = 'expired'
  WHERE user_id = auth.uid() AND task_id = p_task_id AND status = 'started';

  INSERT INTO public.task_verification_sessions (user_id, task_id)
  VALUES (auth.uid(), p_task_id)
  RETURNING * INTO v_session;
  RETURN v_session;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_task_verification(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.start_task_verification(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.complete_verified_task_session(
  p_session_id uuid,
  p_provider_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.task_verification_sessions%ROWTYPE;
  v_task public.tasks%ROWTYPE;
  v_completion_id uuid;
  v_existing_status text;
  v_reward_balance numeric(12,2);
  v_referral_balance numeric(12,2);
  v_reward numeric(10,2);
  v_daily_count integer;
  v_daily_limit integer;
  v_daily_earning_cap numeric(12,2);
  v_daily_earned numeric(12,2);
  v_plan_code text;
  v_referrer_id uuid;
  v_commission_percent numeric(5,2);
  v_commission numeric(12,2);
  v_required_rank integer;
  v_user_rank integer;
  v_task_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;

  SELECT * INTO v_session FROM public.task_verification_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification session not found'; END IF;
  IF v_session.status = 'completed' THEN RETURN v_session.completion_id; END IF;
  IF v_session.status <> 'started' OR v_session.expires_at <= now() THEN
    UPDATE public.task_verification_sessions SET status = 'expired' WHERE id = p_session_id;
    INSERT INTO public.task_verification_events (session_id, user_id, task_id, result, provider_reference)
    VALUES (p_session_id, v_session.user_id, v_session.task_id, 'expired', p_provider_reference);
    RAISE EXCEPTION 'Verification session has expired';
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE user_id = v_session.user_id AND account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member account is not active'; END IF;

  SELECT * INTO v_task FROM public.tasks
  WHERE id = v_session.task_id AND is_active AND is_funded
    AND verification_mode = 'automatic'
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task is not eligible for automatic credit'; END IF;

  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions
  WHERE user_id = v_session.user_id AND status = 'active'
    AND starts_at <= now() AND ends_at > now()
  ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap
  FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_user_rank FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_required_rank FROM public.tasks WHERE id = v_session.task_id;
  IF v_user_rank IS NULL OR v_user_rank < v_required_rank THEN
    RAISE EXCEPTION 'Task plan requirement is not met';
  END IF;

  SELECT count(*) INTO v_daily_count FROM public.task_completions
  WHERE user_id = v_session.user_id AND status IN ('pending', 'approved')
    AND completed_at >= date_trunc('day', now());
  IF v_daily_count >= v_daily_limit THEN RAISE EXCEPTION 'Daily task limit reached'; END IF;

  IF v_daily_earning_cap IS NOT NULL THEN
    SELECT COALESCE(sum(t.reward), 0) INTO v_daily_earned
    FROM public.task_completions AS completion
    JOIN public.tasks AS t ON t.id = completion.task_id
    WHERE completion.user_id = v_session.user_id
      AND completion.status IN ('pending', 'approved')
      AND completion.completed_at >= date_trunc('day', now());
    IF v_daily_earned + v_task.reward > v_daily_earning_cap THEN RAISE EXCEPTION 'Daily earning cap reached'; END IF;
  END IF;
  IF v_task.daily_quota > 0 THEN
    SELECT count(*) INTO v_task_count FROM public.task_completions
    WHERE task_id = v_session.task_id AND status IN ('pending', 'approved')
      AND completed_at >= date_trunc('day', now());
    IF v_task_count >= v_task.daily_quota THEN RAISE EXCEPTION 'Task daily quota reached'; END IF;
  END IF;

  SELECT id, status INTO v_completion_id, v_existing_status
  FROM public.task_completions
  WHERE user_id = v_session.user_id AND task_id = v_session.task_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_status <> 'rejected' THEN RAISE EXCEPTION 'Task was already credited'; END IF;
    UPDATE public.task_completions
    SET status = 'approved',
        completed_at = now(),
        reviewed_at = now(),
        reviewed_by = NULL,
        proof_text = NULL,
        proof_path = NULL,
        review_note = 'Verified by partner callback'
    WHERE id = v_completion_id;
  ELSE
    INSERT INTO public.task_completions (
      user_id, task_id, status, completed_at, reviewed_at, review_note
    ) VALUES (
      v_session.user_id, v_session.task_id, 'approved', now(), now(), 'Verified by partner callback'
    ) RETURNING id INTO v_completion_id;
  END IF;

  SELECT reward_balance INTO v_reward_balance FROM public.balances
  WHERE user_id = v_session.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member wallet not found'; END IF;
  v_reward := v_task.reward;
  UPDATE public.balances
  SET reward_balance = reward_balance + v_reward,
      total_earned = total_earned + v_reward,
      updated_at = now()
  WHERE user_id = v_session.user_id;
  INSERT INTO public.wallet_ledger (
    user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
  ) VALUES (
    v_session.user_id, NULL, 'reward', v_reward, v_reward_balance,
    v_reward_balance + v_reward, 'Automatically verified task ' || v_session.task_id::text
  );

  SELECT referrer_id INTO v_referrer_id FROM public.referrals WHERE referred_id = v_session.user_id;
  IF v_referrer_id IS NOT NULL THEN
    SELECT plan_code INTO v_plan_code FROM public.user_subscriptions
    WHERE user_id = v_referrer_id AND status = 'active'
      AND starts_at <= now() AND ends_at > now()
    ORDER BY starts_at DESC LIMIT 1;
    SELECT referral_commission_percent INTO v_commission_percent
    FROM public.subscription_plans WHERE plan_code = COALESCE(v_plan_code, 'free') AND is_active;
    v_commission := round(v_reward * COALESCE(v_commission_percent, 0) / 100, 2);
    IF v_commission > 0 THEN
      SELECT referral_balance INTO v_referral_balance FROM public.balances
      WHERE user_id = v_referrer_id FOR UPDATE;
      UPDATE public.balances
      SET referral_balance = referral_balance + v_commission,
          total_earned = total_earned + v_commission,
          updated_at = now()
      WHERE user_id = v_referrer_id;
      INSERT INTO public.wallet_ledger (
        user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
      ) VALUES (
        v_referrer_id, NULL, 'referral', v_commission, v_referral_balance,
        v_referral_balance + v_commission, 'Referral commission for verified task ' || v_session.task_id::text
      );
    END IF;
  END IF;

  UPDATE public.task_verification_sessions
  SET status = 'completed', provider_reference = p_provider_reference,
      completion_id = v_completion_id, completed_at = now()
  WHERE id = p_session_id;
  INSERT INTO public.task_verification_events (session_id, user_id, task_id, result, provider_reference)
  VALUES (p_session_id, v_session.user_id, v_session.task_id, 'verified', p_provider_reference);
  RETURN v_completion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_verified_task_session(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_verified_task_session(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.require_manual_task_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')
    AND EXISTS (
      SELECT 1 FROM public.tasks
      WHERE id = NEW.task_id AND verification_mode = 'automatic'
    ) THEN
    RAISE EXCEPTION 'Automatic-verification tasks cannot be manually reviewed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_manual_task_review
  BEFORE UPDATE OF status ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.require_manual_task_review();

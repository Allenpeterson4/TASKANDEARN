ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS max_withdrawal numeric(12,2) NOT NULL DEFAULT 500 CHECK (max_withdrawal >= 0),
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'lifetime'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS leaderboard_opt_in boolean NOT NULL DEFAULT false;
GRANT UPDATE (leaderboard_opt_in) ON public.profiles TO authenticated;

UPDATE public.subscription_plans SET
  name = CASE plan_code WHEN 'free' THEN 'H. Free' WHEN 'premium' THEN 'H. Maniac' WHEN 'vip' THEN 'H. Supreme Max' ELSE name END,
  price = CASE plan_code WHEN 'free' THEN 0 WHEN 'premium' THEN 5000 WHEN 'vip' THEN 20000 ELSE price END,
  max_withdrawal = CASE plan_code WHEN 'free' THEN 500 WHEN 'premium' THEN 1000 WHEN 'vip' THEN 4000 ELSE max_withdrawal END,
  billing_period = 'monthly',
  description = CASE plan_code
    WHEN 'free' THEN 'Free access with withdrawals up to ₦500.'
    WHEN 'premium' THEN '₦5,000 monthly. Withdraw up to ₦1,000 per request.'
    WHEN 'vip' THEN '₦20,000 monthly. Withdraw up to ₦4,000 per request.'
    ELSE description
  END
WHERE plan_code IN ('free', 'premium', 'vip');

INSERT INTO public.subscription_plans (
  plan_code, name, price, currency, daily_task_limit, daily_earning_cap,
  referral_commission_percent, description, max_withdrawal, billing_period, is_active
) VALUES (
  'president', 'H. President Max', 50000, 'NGN', 2147483647, NULL,
  15, '₦50,000 lifetime access with withdrawals up to ₦5,000 per request.', 5000, 'lifetime', true
) ON CONFLICT (plan_code) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, daily_task_limit = EXCLUDED.daily_task_limit,
  daily_earning_cap = EXCLUDED.daily_earning_cap,
  referral_commission_percent = EXCLUDED.referral_commission_percent,
  description = EXCLUDED.description, max_withdrawal = EXCLUDED.max_withdrawal,
  billing_period = EXCLUDED.billing_period, is_active = true;

CREATE OR REPLACE FUNCTION public.set_subscription_term()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period text;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT billing_period INTO v_period FROM public.subscription_plans WHERE plan_code = NEW.plan_code;
    NEW.starts_at := COALESCE(NEW.starts_at, now());
    NEW.ends_at := CASE WHEN v_period = 'lifetime' THEN NULL ELSE NEW.starts_at + interval '30 days' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_subscription_term ON public.user_subscriptions;
CREATE TRIGGER set_subscription_term
  BEFORE INSERT OR UPDATE OF status, plan_code, starts_at ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_subscription_term();

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_subscription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM public.user_subscriptions current
    WHERE current.user_id = NEW.user_id
      AND current.id IS DISTINCT FROM NEW.id
      AND current.status = 'active'
      AND (current.ends_at IS NULL OR current.ends_at > now())
  ) THEN
    RAISE EXCEPTION 'An active paid plan already exists';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_duplicate_active_subscription ON public.user_subscriptions;
CREATE TRIGGER prevent_duplicate_active_subscription
  BEFORE INSERT OR UPDATE OF status, user_id ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_active_subscription();

CREATE TABLE IF NOT EXISTS public.platform_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  referral_signup_reward numeric(12,2) NOT NULL DEFAULT 200 CHECK (referral_signup_reward >= 0),
  referral_first_hustle_reward numeric(12,2) NOT NULL DEFAULT 200 CHECK (referral_first_hustle_reward >= 0),
  milestone_reward numeric(12,2) NOT NULL DEFAULT 2000 CHECK (milestone_reward >= 0),
  hustler_withdrawals_enabled boolean NOT NULL DEFAULT true,
  referral_withdrawals_enabled boolean NOT NULL DEFAULT true,
  withdrawal_failure_message text NOT NULL DEFAULT 'Your account has not met the withdrawal requirements yet.',
  minimum_hustles integer NOT NULL DEFAULT 0 CHECK (minimum_hustles >= 0),
  require_all_hustles boolean NOT NULL DEFAULT false,
  minimum_hustle_level integer NOT NULL DEFAULT 0 CHECK (minimum_hustle_level BETWEEN 0 AND 6),
  minimum_referrals integer NOT NULL DEFAULT 0 CHECK (minimum_referrals >= 0),
  minimum_checkin_streak integer NOT NULL DEFAULT 0 CHECK (minimum_checkin_streak >= 0),
  minimum_online_minutes integer NOT NULL DEFAULT 0 CHECK (minimum_online_minutes >= 0),
  minimum_interactions integer NOT NULL DEFAULT 0 CHECK (minimum_interactions >= 0),
  measurement_days integer NOT NULL DEFAULT 30 CHECK (measurement_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT INSERT, UPDATE ON public.platform_settings TO authenticated;
DROP POLICY IF EXISTS members_read_platform_settings ON public.platform_settings;
CREATE POLICY members_read_platform_settings ON public.platform_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS admins_manage_platform_settings ON public.platform_settings;
CREATE POLICY admins_manage_platform_settings ON public.platform_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.platform_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.daily_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checkin_date date NOT NULL DEFAULT current_date,
  streak integer NOT NULL CHECK (streak > 0),
  reward numeric(12,2) NOT NULL CHECK (reward >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkin_date)
);
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.daily_checkins TO authenticated;
DROP POLICY IF EXISTS users_read_own_checkins ON public.daily_checkins;
CREATE POLICY users_read_own_checkins ON public.daily_checkins FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP FUNCTION IF EXISTS public.claim_daily_checkin();
CREATE FUNCTION public.claim_daily_checkin()
RETURNS public.daily_checkins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last public.daily_checkins%ROWTYPE;
  v_checkin public.daily_checkins%ROWTYPE;
  v_streak integer;
  v_day integer;
  v_reward numeric(12,2);
  v_before numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This account is not active'; END IF;
  SELECT * INTO v_last FROM public.daily_checkins WHERE user_id = auth.uid() ORDER BY checkin_date DESC LIMIT 1;
  IF v_last.checkin_date = current_date THEN RAISE EXCEPTION 'Your daily check-in is already claimed'; END IF;
  v_streak := CASE WHEN v_last.checkin_date = current_date - 1 THEN v_last.streak + 1 ELSE 1 END;
  v_day := ((v_streak - 1) % 7) + 1;
  v_reward := CASE v_day WHEN 1 THEN 50 WHEN 2 THEN 75 WHEN 3 THEN 100 WHEN 4 THEN 125 WHEN 5 THEN 150 WHEN 6 THEN 200 ELSE 350 END;
  SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  INSERT INTO public.daily_checkins (user_id, checkin_date, streak, reward)
  VALUES (auth.uid(), current_date, v_streak, v_reward) RETURNING * INTO v_checkin;
  UPDATE public.balances SET reward_balance = reward_balance + v_reward, total_earned = total_earned + v_reward, updated_at = now() WHERE user_id = auth.uid();
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (auth.uid(), auth.uid(), 'reward', v_reward, v_before, v_before + v_reward, 'Daily hustle check-in day ' || v_day::text);
  RETURN v_checkin;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_daily_checkin() TO authenticated;
REVOKE ALL ON FUNCTION public.claim_daily_checkin() FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.user_activity_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_date date NOT NULL DEFAULT current_date,
  online_seconds integer NOT NULL DEFAULT 0 CHECK (online_seconds >= 0),
  interactions integer NOT NULL DEFAULT 0 CHECK (interactions >= 0),
  paid_online_blocks integer NOT NULL DEFAULT 0 CHECK (paid_online_blocks >= 0),
  paid_interaction_blocks integer NOT NULL DEFAULT 0 CHECK (paid_interaction_blocks >= 0),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_date)
);
ALTER TABLE public.user_activity_daily ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_activity_daily TO authenticated;
DROP POLICY IF EXISTS users_read_own_activity ON public.user_activity_daily;
CREATE POLICY users_read_own_activity ON public.user_activity_daily FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.record_user_activity(p_elapsed_seconds integer, p_interactions integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activity public.user_activity_daily%ROWTYPE;
  v_elapsed integer;
  v_recorded_interactions integer;
  v_online_blocks integer;
  v_interaction_blocks integer;
  v_reward numeric(12,2) := 0;
  v_before numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF p_elapsed_seconds NOT BETWEEN 0 AND 120 OR p_interactions NOT BETWEEN 0 AND 50 THEN RAISE EXCEPTION 'Invalid activity batch'; END IF;
  INSERT INTO public.user_activity_daily (user_id, activity_date) VALUES (auth.uid(), current_date)
  ON CONFLICT (user_id, activity_date) DO NOTHING;
  SELECT * INTO v_activity FROM public.user_activity_daily WHERE user_id = auth.uid() AND activity_date = current_date FOR UPDATE;
  v_elapsed := LEAST(p_elapsed_seconds, GREATEST(0, floor(extract(epoch FROM now() - v_activity.last_heartbeat_at))::integer), 120);
  v_recorded_interactions := LEAST(p_interactions, floor(v_elapsed / 2.0)::integer);
  UPDATE public.user_activity_daily SET
    online_seconds = online_seconds + v_elapsed,
    interactions = interactions + v_recorded_interactions,
    last_heartbeat_at = now(),
    last_activity_at = now()
  WHERE user_id = auth.uid() AND activity_date = current_date
  RETURNING * INTO v_activity;
  v_online_blocks := v_activity.online_seconds / 1800;
  v_interaction_blocks := v_activity.interactions / 100;
  v_reward := GREATEST(0, v_online_blocks - v_activity.paid_online_blocks) * 5
    + GREATEST(0, v_interaction_blocks - v_activity.paid_interaction_blocks) * 0.1;
  IF v_reward > 0 THEN
    SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
    UPDATE public.balances SET reward_balance = reward_balance + v_reward, total_earned = total_earned + v_reward, updated_at = now() WHERE user_id = auth.uid();
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (auth.uid(), auth.uid(), 'reward', v_reward, v_before, v_before + v_reward, 'Verified site engagement reward');
  END IF;
  UPDATE public.user_activity_daily SET paid_online_blocks = v_online_blocks, paid_interaction_blocks = v_interaction_blocks
  WHERE user_id = auth.uid() AND activity_date = current_date;
  RETURN jsonb_build_object('online_seconds', v_activity.online_seconds, 'interactions', v_activity.interactions, 'reward', v_reward);
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_user_activity(integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.record_user_activity(integer, integer) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.reward_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone_type text NOT NULL CHECK (milestone_type IN ('hustles', 'referrals')),
  milestone_value integer NOT NULL CHECK (milestone_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone_type, milestone_value)
);
ALTER TABLE public.reward_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reward_milestones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reward_milestones TO authenticated;
DROP POLICY IF EXISTS users_read_own_reward_milestones ON public.reward_milestones;
CREATE POLICY users_read_own_reward_milestones ON public.reward_milestones FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_read_reward_milestones ON public.reward_milestones;
CREATE POLICY admins_read_reward_milestones ON public.reward_milestones FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.pay_hustle_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_milestone integer;
  v_event uuid;
  v_bonus numeric(12,2);
  v_before numeric(12,2);
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.task_completions WHERE user_id = NEW.user_id AND status = 'approved';
  SELECT milestone_reward INTO v_bonus FROM public.platform_settings WHERE singleton;
  FOR v_milestone IN 100..v_count BY 100 LOOP
    INSERT INTO public.reward_milestones (user_id, milestone_type, milestone_value)
    VALUES (NEW.user_id, 'hustles', v_milestone) ON CONFLICT DO NOTHING RETURNING id INTO v_event;
    IF v_event IS NOT NULL THEN
      SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = NEW.user_id FOR UPDATE;
      UPDATE public.balances SET reward_balance = reward_balance + v_bonus, total_earned = total_earned + v_bonus, updated_at = now() WHERE user_id = NEW.user_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (NEW.user_id, NEW.user_id, 'reward', v_bonus, v_before, v_before + v_bonus, 'Hustle milestone: ' || v_milestone::text || ' completed hustles');
    END IF;
    v_event := NULL;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pay_hustle_milestone ON public.task_completions;
CREATE TRIGGER pay_hustle_milestone AFTER INSERT OR UPDATE OF status ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.pay_hustle_milestone();

CREATE OR REPLACE FUNCTION public.pay_referral_milestone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_milestone integer;
  v_event uuid;
  v_bonus numeric(12,2);
  v_before numeric(12,2);
BEGIN
  SELECT count(*) INTO v_count FROM public.referrals WHERE referrer_id = NEW.referrer_id;
  SELECT milestone_reward INTO v_bonus FROM public.platform_settings WHERE singleton;
  FOR v_milestone IN 100..v_count BY 100 LOOP
    INSERT INTO public.reward_milestones (user_id, milestone_type, milestone_value)
    VALUES (NEW.referrer_id, 'referrals', v_milestone) ON CONFLICT DO NOTHING RETURNING id INTO v_event;
    IF v_event IS NOT NULL THEN
      SELECT referral_balance INTO v_before FROM public.balances WHERE user_id = NEW.referrer_id FOR UPDATE;
      UPDATE public.balances SET referral_balance = referral_balance + v_bonus, total_earned = total_earned + v_bonus, updated_at = now() WHERE user_id = NEW.referrer_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (NEW.referrer_id, NEW.referrer_id, 'referral', v_bonus, v_before, v_before + v_bonus, 'Referral milestone: ' || v_milestone::text || ' referrals');
    END IF;
    v_event := NULL;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pay_referral_milestone ON public.referrals;
CREATE TRIGGER pay_referral_milestone AFTER INSERT ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.pay_referral_milestone();

CREATE OR REPLACE FUNCTION public.get_hustle_score(p_user_id uuid DEFAULT auth.uid())
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_approved integer;
  v_total integer;
  v_referrals integer;
  v_streak integer;
BEGIN
  IF auth.uid() IS NULL OR (p_user_id <> auth.uid() AND NOT public.is_admin()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT count(*) FILTER (WHERE status = 'approved'), count(*) INTO v_approved, v_total
  FROM public.task_completions WHERE user_id = p_user_id;
  SELECT count(*) INTO v_referrals FROM public.referrals WHERE referrer_id = p_user_id;
  SELECT streak INTO v_streak FROM public.daily_checkins WHERE user_id = p_user_id ORDER BY checkin_date DESC LIMIT 1;
  RETURN LEAST(100, greatest(0, LEAST(COALESCE(v_approved, 0), 40) + LEAST(COALESCE(v_referrals, 0), 20) + LEAST(COALESCE(v_streak, 0), 20) * 2 + CASE WHEN COALESCE(v_total, 0) > 0 THEN 20 ELSE 0 END));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_hustle_score(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_hustle_score(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_category text DEFAULT 'earnings')
RETURNS TABLE ("position" integer, user_id uuid, display_name text, avatar_url text, score numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_category NOT IN ('earnings', 'hustles', 'referrals') THEN RAISE EXCEPTION 'Invalid leaderboard category'; END IF;
  RETURN QUERY
  WITH scores AS (
    SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.public_activity_opt_in,
      CASE p_category
        WHEN 'earnings' THEN COALESCE(b.total_earned, 0)
        WHEN 'hustles' THEN (SELECT count(*)::numeric FROM public.task_completions c WHERE c.user_id = p.user_id AND c.status = 'approved')
        ELSE (SELECT count(*)::numeric FROM public.referrals r WHERE r.referrer_id = p.user_id)
      END AS metric
    FROM public.profiles p LEFT JOIN public.balances b ON b.user_id = p.user_id
    WHERE p.account_status = 'active'
  ), ranked AS (
    SELECT row_number() OVER (ORDER BY metric DESC, user_id)::integer AS rank, * FROM scores WHERE metric > 0
  )
  SELECT ranked.rank, CASE WHEN public.is_admin() OR ranked.leaderboard_opt_in THEN ranked.user_id ELSE NULL::uuid END,
    CASE WHEN ranked.public_activity_opt_in THEN COALESCE(NULLIF(ranked.full_name, ''), ranked.username)
      ELSE 'Hustler ' || substr(ranked.user_id::text, 1, 6) END,
    CASE WHEN ranked.public_activity_opt_in THEN ranked.avatar_url ELSE NULL END,
    ranked.metric
  FROM ranked WHERE ranked.rank <= 20 ORDER BY ranked.rank;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_leaderboard(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.update_referral_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.referrals WHERE referrer_id = NEW.referrer_id;
  UPDATE public.profiles SET tier = CASE WHEN v_count >= 50 THEN 'Platinum' WHEN v_count >= 20 THEN 'Gold' WHEN v_count >= 5 THEN 'Silver' ELSE 'Bronze' END
  WHERE user_id = NEW.referrer_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS update_referral_tier ON public.referrals;
CREATE TRIGGER update_referral_tier AFTER INSERT ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.update_referral_tier();
WITH referral_counts AS (
  SELECT p.user_id, count(r.id) AS total FROM public.profiles p LEFT JOIN public.referrals r ON r.referrer_id = p.user_id GROUP BY p.user_id
)
UPDATE public.profiles p SET tier = CASE WHEN referral_counts.total >= 50 THEN 'Platinum' WHEN referral_counts.total >= 20 THEN 'Gold' WHEN referral_counts.total >= 5 THEN 'Silver' ELSE 'Bronze' END
FROM referral_counts WHERE p.user_id = referral_counts.user_id;

CREATE OR REPLACE FUNCTION public.claim_task(
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
  v_campaign_reservations integer;
  v_plan_code text;
  v_required_rank integer;
  v_user_rank integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This account is not active'; END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND is_active AND is_funded
    AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
    AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
  IF NOT FOUND OR NOT v_task.is_funded THEN RAISE EXCEPTION 'This hustle is unavailable'; END IF;
  IF v_task.campaign_budget_remaining IS NOT NULL THEN
    SELECT count(*) INTO v_campaign_reservations FROM public.task_completions WHERE task_id = p_task_id AND status = 'pending';
    IF v_task.campaign_budget_remaining < v_task.reward * (v_campaign_reservations + 1) THEN RAISE EXCEPTION 'Campaign funds are reserved for existing submissions'; END IF;
  END IF;
  IF v_task.proof_required AND length(btrim(COALESCE(p_proof_text, ''))) = 0 AND p_proof_path IS NULL THEN RAISE EXCEPTION 'Proof is required for this hustle'; END IF;
  IF length(COALESCE(p_proof_text, '')) > 2000 THEN RAISE EXCEPTION 'Proof must be 2000 characters or fewer'; END IF;
  IF p_proof_path IS NOT NULL THEN
    IF p_proof_path NOT LIKE (auth.uid()::text || '/%') OR length(p_proof_path) > 500 THEN RAISE EXCEPTION 'Invalid proof upload path'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'task-proofs' AND name = p_proof_path) THEN RAISE EXCEPTION 'Proof upload was not found'; END IF;
  END IF;

  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'active' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
  ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_user_rank FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_required_rank FROM public.tasks WHERE id = p_task_id;
  IF v_user_rank IS NULL OR v_user_rank < v_required_rank THEN RAISE EXCEPTION 'This hustle requires the % plan', initcap(v_task.required_plan_code); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE plan_code = v_task.required_plan_code AND is_active) THEN RAISE EXCEPTION 'This plan is not currently available'; END IF;
  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  IF v_daily_limit IS NULL THEN RAISE EXCEPTION 'No active subscription plan is available'; END IF;
  SELECT count(*) INTO v_daily_count FROM public.task_completions WHERE user_id = auth.uid() AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
  IF v_daily_count >= v_daily_limit THEN RAISE EXCEPTION 'You have reached the daily hustle limit for your plan'; END IF;
  IF v_daily_earning_cap IS NOT NULL THEN
    SELECT COALESCE(sum(t.reward), 0) INTO v_daily_earned FROM public.task_completions c JOIN public.tasks t ON t.id = c.task_id
    WHERE c.user_id = auth.uid() AND c.status IN ('pending', 'approved') AND c.completed_at >= date_trunc('day', now());
    IF v_daily_earned + v_task.reward > v_daily_earning_cap THEN RAISE EXCEPTION 'You have reached the daily earning cap for your plan'; END IF;
  END IF;
  IF v_task.daily_quota > 0 THEN
    SELECT count(*) INTO v_daily_count FROM public.task_completions WHERE task_id = p_task_id AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
    IF v_daily_count >= v_task.daily_quota THEN RAISE EXCEPTION 'The daily hustle quota has been reached'; END IF;
  END IF;
  SELECT * INTO v_completion FROM public.task_completions WHERE user_id = auth.uid() AND task_id = p_task_id FOR UPDATE;
  IF FOUND THEN
    IF v_completion.status <> 'rejected' THEN RAISE EXCEPTION 'This hustle has already been submitted'; END IF;
    UPDATE public.task_completions SET status = 'pending', proof_text = NULLIF(btrim(p_proof_text), ''), proof_path = p_proof_path,
      review_note = NULL, reviewed_at = NULL, reviewed_by = NULL, completed_at = now()
    WHERE id = v_completion.id RETURNING * INTO v_completion;
    RETURN v_completion;
  END IF;
  INSERT INTO public.task_completions (user_id, task_id, status, proof_text, proof_path)
  VALUES (auth.uid(), p_task_id, 'pending', NULLIF(btrim(p_proof_text), ''), p_proof_path) RETURNING * INTO v_completion;
  RETURN v_completion;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_task(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_task(uuid, text, text) FROM PUBLIC, anon;

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
  v_campaign_reservations integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF NOT public.user_feature_enabled(auth.uid(), 'hustles') THEN RAISE EXCEPTION 'Hustles are not available for your plan'; END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND is_active AND is_funded
    AND verification_mode = 'automatic' AND length(btrim(task_url)) > 0
    AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
    AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This hustle is not available for automatic tracking'; END IF;
  IF v_task.campaign_budget_remaining IS NOT NULL THEN
    SELECT (SELECT count(*) FROM public.task_completions WHERE task_id = p_task_id AND status = 'pending')
      + (SELECT count(*) FROM public.task_verification_sessions WHERE task_id = p_task_id AND status = 'started' AND expires_at > now())
      INTO v_campaign_reservations;
    IF v_task.campaign_budget_remaining < v_task.reward * (v_campaign_reservations + 1) THEN RAISE EXCEPTION 'Campaign funds are reserved for active submissions'; END IF;
  END IF;
  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'active'
    AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_user_rank FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_required_rank FROM public.tasks WHERE id = p_task_id;
  IF v_user_rank IS NULL OR v_user_rank < v_required_rank THEN RAISE EXCEPTION 'This hustle requires the % plan', initcap(v_task.required_plan_code); END IF;
  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT count(*) INTO v_daily_count FROM public.task_completions WHERE user_id = auth.uid() AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
  IF v_daily_count >= v_daily_limit THEN RAISE EXCEPTION 'You have reached the daily hustle limit for your plan'; END IF;
  IF v_daily_earning_cap IS NOT NULL THEN
    SELECT COALESCE(sum(t.reward), 0) INTO v_daily_earned FROM public.task_completions c JOIN public.tasks t ON t.id = c.task_id
    WHERE c.user_id = auth.uid() AND c.status IN ('pending', 'approved') AND c.completed_at >= date_trunc('day', now());
    IF v_daily_earned + v_task.reward > v_daily_earning_cap THEN RAISE EXCEPTION 'You have reached the daily earning cap for your plan'; END IF;
  END IF;
  IF v_task.daily_quota > 0 THEN
    SELECT count(*) INTO v_task_count FROM public.task_completions WHERE task_id = p_task_id AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
    IF v_task_count >= v_task.daily_quota THEN RAISE EXCEPTION 'The daily hustle quota has been reached'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_completions WHERE user_id = auth.uid() AND task_id = p_task_id AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'This hustle has already been submitted';
  END IF;
  UPDATE public.task_verification_sessions SET status = 'expired' WHERE user_id = auth.uid() AND task_id = p_task_id AND status = 'started';
  INSERT INTO public.task_verification_sessions (user_id, task_id) VALUES (auth.uid(), p_task_id) RETURNING * INTO v_session;
  RETURN v_session;
END;
$$;
GRANT EXECUTE ON FUNCTION public.start_task_verification(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.start_task_verification(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.complete_verified_task_session(p_session_id uuid, p_provider_reference text DEFAULT NULL)
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
  v_campaign_reservations integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO v_session FROM public.task_verification_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification session not found'; END IF;
  IF v_session.status = 'completed' THEN RETURN v_session.completion_id; END IF;
  IF v_session.status <> 'started' OR v_session.expires_at <= now() THEN
    UPDATE public.task_verification_sessions SET status = 'expired' WHERE id = p_session_id;
    INSERT INTO public.task_verification_events (session_id, user_id, task_id, result, provider_reference) VALUES (p_session_id, v_session.user_id, v_session.task_id, 'expired', p_provider_reference);
    RAISE EXCEPTION 'Verification session has expired';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = v_session.user_id AND account_status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hustler account is not active'; END IF;
  IF NOT public.user_feature_enabled(v_session.user_id, 'hustles') THEN RAISE EXCEPTION 'Hustles are not available for this plan'; END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = v_session.task_id AND is_active AND is_funded
    AND verification_mode = 'automatic' AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
    AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hustle is not eligible for automatic credit'; END IF;
  IF v_task.campaign_budget_remaining IS NOT NULL THEN
    SELECT (SELECT count(*) FROM public.task_completions WHERE task_id = v_session.task_id AND status = 'pending')
      + (SELECT count(*) FROM public.task_verification_sessions WHERE task_id = v_session.task_id AND status = 'started' AND expires_at > now())
      INTO v_campaign_reservations;
    IF v_task.campaign_budget_remaining < v_task.reward * v_campaign_reservations THEN RAISE EXCEPTION 'Campaign funds are reserved for active submissions'; END IF;
  END IF;
  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions WHERE user_id = v_session.user_id AND status = 'active'
    AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_user_rank FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 WHEN 'president' THEN 3 ELSE 0 END
  INTO v_required_rank FROM public.tasks WHERE id = v_session.task_id;
  IF v_user_rank IS NULL OR v_user_rank < v_required_rank THEN RAISE EXCEPTION 'Hustle plan requirement is not met'; END IF;
  SELECT daily_task_limit, daily_earning_cap INTO v_daily_limit, v_daily_earning_cap FROM public.subscription_plans WHERE plan_code = v_plan_code AND is_active;
  SELECT count(*) INTO v_daily_count FROM public.task_completions WHERE user_id = v_session.user_id AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
  IF v_daily_count >= v_daily_limit THEN RAISE EXCEPTION 'Daily hustle limit reached'; END IF;
  IF v_daily_earning_cap IS NOT NULL THEN
    SELECT COALESCE(sum(t.reward), 0) INTO v_daily_earned FROM public.task_completions c JOIN public.tasks t ON t.id = c.task_id
    WHERE c.user_id = v_session.user_id AND c.status IN ('pending', 'approved') AND c.completed_at >= date_trunc('day', now());
    IF v_daily_earned + v_task.reward > v_daily_earning_cap THEN RAISE EXCEPTION 'Daily earning cap reached'; END IF;
  END IF;
  IF v_task.daily_quota > 0 THEN
    SELECT count(*) INTO v_task_count FROM public.task_completions WHERE task_id = v_session.task_id AND status IN ('pending', 'approved') AND completed_at >= date_trunc('day', now());
    IF v_task_count >= v_task.daily_quota THEN RAISE EXCEPTION 'Hustle daily quota reached'; END IF;
  END IF;
  SELECT id, status INTO v_completion_id, v_existing_status FROM public.task_completions WHERE user_id = v_session.user_id AND task_id = v_session.task_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_status <> 'rejected' THEN RAISE EXCEPTION 'Hustle was already credited'; END IF;
    UPDATE public.task_completions SET status = 'approved', completed_at = now(), reviewed_at = now(), reviewed_by = NULL,
      proof_text = NULL, proof_path = NULL, review_note = 'Verified by partner callback' WHERE id = v_completion_id;
  ELSE
    INSERT INTO public.task_completions (user_id, task_id, status, completed_at, reviewed_at, review_note)
    VALUES (v_session.user_id, v_session.task_id, 'approved', now(), now(), 'Verified by partner callback') RETURNING id INTO v_completion_id;
  END IF;
  SELECT reward_balance INTO v_reward_balance FROM public.balances WHERE user_id = v_session.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hustler wallet not found'; END IF;
  UPDATE public.balances SET reward_balance = reward_balance + v_task.reward, total_earned = total_earned + v_task.reward, updated_at = now() WHERE user_id = v_session.user_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (v_session.user_id, NULL, 'reward', v_task.reward, v_reward_balance, v_reward_balance + v_task.reward, 'Automatically verified hustle ' || v_session.task_id::text);
  SELECT referrer_id INTO v_referrer_id FROM public.referrals WHERE referred_id = v_session.user_id;
  IF v_referrer_id IS NOT NULL THEN
    SELECT plan_code INTO v_plan_code FROM public.user_subscriptions WHERE user_id = v_referrer_id AND status = 'active'
      AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY starts_at DESC LIMIT 1;
    SELECT referral_commission_percent INTO v_commission_percent FROM public.subscription_plans WHERE plan_code = COALESCE(v_plan_code, 'free') AND is_active;
    v_commission := round(v_task.reward * COALESCE(v_commission_percent, 0) / 100, 2);
    IF v_commission > 0 THEN
      SELECT referral_balance INTO v_referral_balance FROM public.balances WHERE user_id = v_referrer_id FOR UPDATE;
      UPDATE public.balances SET referral_balance = referral_balance + v_commission, total_earned = total_earned + v_commission, updated_at = now() WHERE user_id = v_referrer_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (v_referrer_id, NULL, 'referral', v_commission, v_referral_balance, v_referral_balance + v_commission, 'Referral commission for verified hustle ' || v_session.task_id::text);
    END IF;
  END IF;
  UPDATE public.task_verification_sessions SET status = 'completed', provider_reference = p_provider_reference,
    completion_id = v_completion_id, completed_at = now() WHERE id = p_session_id;
  INSERT INTO public.task_verification_events (session_id, user_id, task_id, result, provider_reference)
  VALUES (p_session_id, v_session.user_id, v_session.task_id, 'verified', p_provider_reference);
  RETURN v_completion_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_verified_task_session(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_verified_task_session(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.leaderboard_reward_settings (
  rank integer PRIMARY KEY CHECK (rank BETWEEN 1 AND 20),
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.leaderboard_reward_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.leaderboard_reward_settings TO authenticated;
DROP POLICY IF EXISTS admins_manage_leaderboard_rewards ON public.leaderboard_reward_settings;
CREATE POLICY admins_manage_leaderboard_rewards ON public.leaderboard_reward_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.leaderboard_reward_settings (rank, amount, enabled)
SELECT rank, CASE rank WHEN 1 THEN 5000 WHEN 2 THEN 3000 WHEN 3 THEN 2000 ELSE 0 END, rank <= 3
FROM generate_series(1, 20) AS rank ON CONFLICT (rank) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.leaderboard_reward_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  category text NOT NULL CHECK (category IN ('earnings', 'hustles', 'referrals')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 20),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, category, user_id)
);
ALTER TABLE public.leaderboard_reward_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.leaderboard_reward_runs TO authenticated;
DROP POLICY IF EXISTS admins_read_leaderboard_reward_runs ON public.leaderboard_reward_runs;
CREATE POLICY admins_read_leaderboard_reward_runs ON public.leaderboard_reward_runs FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_issue_leaderboard_rewards(p_category text, p_period_start date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_period date := date_trunc('month', p_period_start)::date;
  v_amount numeric(12,2);
  v_run uuid;
  v_before numeric(12,2);
  v_issued integer := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_category NOT IN ('earnings', 'hustles', 'referrals') THEN RAISE EXCEPTION 'Invalid leaderboard category'; END IF;
  FOR v_entry IN SELECT position, user_id FROM public.get_leaderboard(p_category) LOOP
    SELECT amount INTO v_amount FROM public.leaderboard_reward_settings WHERE rank = v_entry.position AND enabled;
    IF COALESCE(v_amount, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.leaderboard_reward_runs (period_start, category, user_id, rank, amount, issued_by)
    VALUES (v_period, p_category, v_entry.user_id, v_entry.position, v_amount, auth.uid())
    ON CONFLICT (period_start, category, user_id) DO NOTHING RETURNING id INTO v_run;
    IF v_run IS NULL THEN CONTINUE; END IF;
    SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = v_entry.user_id FOR UPDATE;
    UPDATE public.balances SET reward_balance = reward_balance + v_amount, total_earned = total_earned + v_amount, updated_at = now() WHERE user_id = v_entry.user_id;
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (v_entry.user_id, auth.uid(), 'reward', v_amount, v_before, v_before + v_amount, 'Leaderboard rank ' || v_entry.position::text || ' reward for ' || p_category || ' · ' || v_period::text);
    v_issued := v_issued + 1;
    v_run := NULL;
  END LOOP;
  RETURN v_issued;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_issue_leaderboard_rewards(text, date) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_issue_leaderboard_rewards(text, date) FROM PUBLIC, anon;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS hustler_payout_days smallint[] NOT NULL DEFAULT ARRAY[5]::smallint[],
  ADD COLUMN IF NOT EXISTS hustler_window_start time NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS hustler_window_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS hustler_timezone text NOT NULL DEFAULT 'Africa/Lagos',
  ADD COLUMN IF NOT EXISTS referral_payout_days smallint[] NOT NULL DEFAULT ARRAY[5]::smallint[],
  ADD COLUMN IF NOT EXISTS referral_window_start time NOT NULL DEFAULT '14:00',
  ADD COLUMN IF NOT EXISTS referral_window_end time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS referral_timezone text NOT NULL DEFAULT 'Africa/Lagos';

CREATE TABLE IF NOT EXISTS public.dashboard_advertisements (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  image_path text,
  target_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  CHECK (target_url IS NULL OR target_url ~ '^https?://')
);
ALTER TABLE public.dashboard_advertisements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.dashboard_advertisements TO authenticated;
GRANT INSERT, UPDATE ON public.dashboard_advertisements TO authenticated;
DROP POLICY IF EXISTS members_read_dashboard_advertisements ON public.dashboard_advertisements;
CREATE POLICY members_read_dashboard_advertisements ON public.dashboard_advertisements FOR SELECT TO authenticated USING (enabled);
DROP POLICY IF EXISTS admins_manage_dashboard_advertisements ON public.dashboard_advertisements;
CREATE POLICY admins_manage_dashboard_advertisements ON public.dashboard_advertisements FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.dashboard_advertisements (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('dashboard-ads', 'dashboard-ads', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS admins_upload_dashboard_ads ON storage.objects;
CREATE POLICY admins_upload_dashboard_ads ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'dashboard-ads' AND public.is_admin());
DROP POLICY IF EXISTS admins_update_dashboard_ads ON storage.objects;
CREATE POLICY admins_update_dashboard_ads ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'dashboard-ads' AND public.is_admin()) WITH CHECK (bucket_id = 'dashboard-ads' AND public.is_admin());
DROP POLICY IF EXISTS admins_delete_dashboard_ads ON storage.objects;
CREATE POLICY admins_delete_dashboard_ads ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'dashboard-ads' AND public.is_admin());

CREATE TABLE IF NOT EXISTS public.feature_permissions (
  feature_key text PRIMARY KEY CHECK (feature_key ~ '^[a-z0-9_-]{1,60}$'),
  free_enabled boolean NOT NULL DEFAULT true,
  premium_enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.feature_permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.feature_permissions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feature_permissions TO authenticated;
DROP POLICY IF EXISTS members_read_feature_permissions ON public.feature_permissions;
CREATE POLICY members_read_feature_permissions ON public.feature_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS admins_manage_feature_permissions ON public.feature_permissions;
CREATE POLICY admins_manage_feature_permissions ON public.feature_permissions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.feature_permissions (feature_key) VALUES ('hustles'), ('referrals'), ('leaderboard'), ('campaigns'), ('transfers'), ('custom-referral-code'), ('priority-support') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_fraud_flags()
RETURNS TABLE (user_id uuid, flag text, matched_accounts bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  WITH shared_ip AS (
    SELECT ip_address, count(DISTINCT user_id) AS account_count
    FROM public.user_login_history
    WHERE ip_address IS NOT NULL AND btrim(ip_address) <> ''
    GROUP BY ip_address HAVING count(DISTINCT user_id) > 3
  ), ip_flags AS (
    SELECT DISTINCT l.user_id, 'Shared IP: ' || l.ip_address AS flag, s.account_count AS matched_accounts
    FROM public.user_login_history l JOIN shared_ip s USING (ip_address)
    WHERE public.is_admin()
  ), identity_keys AS (
    SELECT p.user_id, 'email:' || left(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z]', '', 'g'), 5) AS key
    FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
    WHERE length(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z]', '', 'g')) >= 5
    UNION ALL
    SELECT user_id, 'username:' || left(regexp_replace(lower(username), '[^a-z]', '', 'g'), 5)
    FROM public.profiles WHERE length(regexp_replace(lower(username), '[^a-z]', '', 'g')) >= 5
  ), shared_identity AS (
    SELECT key, count(DISTINCT user_id) AS account_count FROM identity_keys GROUP BY key HAVING count(DISTINCT user_id) >= 10
  )
  SELECT * FROM ip_flags
  UNION ALL
  SELECT DISTINCT identity_keys.user_id, 'Similar account name', shared_identity.account_count
  FROM identity_keys JOIN shared_identity USING (key)
  WHERE public.is_admin()
$$;
GRANT EXECUTE ON FUNCTION public.admin_fraud_flags() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_fraud_flags() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_dashboard_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT jsonb_build_object(
    'pending_deposits', (SELECT count(*) FROM public.funding_deposits WHERE status = 'pending'),
    'approved_deposits', (SELECT COALESCE(sum(amount), 0) FROM public.funding_deposits WHERE status = 'confirmed'),
    'active_campaigns', (SELECT count(*) FROM public.tasks WHERE is_active AND is_funded),
    'users_online', (SELECT count(DISTINCT user_id) FROM public.user_activity_daily WHERE last_activity_at > now() - interval '5 minutes'),
    'registrations_today', (SELECT count(*) FROM public.profiles WHERE joined_at >= date_trunc('day', now())),
    'referrals_today', (SELECT count(*) FROM public.referrals WHERE created_at >= date_trunc('day', now())),
    'flagged_withdrawals', (SELECT count(*) FROM public.withdrawals w WHERE w.status = 'pending' AND w.user_id IN (SELECT flags.user_id FROM public.admin_fraud_flags() flags)),
    'storage_bytes', (SELECT COALESCE(sum((metadata->>'size')::bigint), 0) FROM storage.objects)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_metrics() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_dashboard_metrics() FROM PUBLIC, anon;

ALTER TABLE public.payout_settings ALTER COLUMN minimum_amount SET DEFAULT 500;
UPDATE public.payout_settings SET minimum_amount = 500 WHERE singleton AND minimum_amount = 5000;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS wallet_type text NOT NULL DEFAULT 'hustler';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.withdrawals'::regclass AND conname = 'withdrawals_wallet_type_check') THEN
    ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_wallet_type_check CHECK (wallet_type IN ('hustler', 'referral')) NOT VALID;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.request_withdrawal(numeric, text, text, text);
CREATE FUNCTION public.request_withdrawal(
  p_amount numeric,
  p_bank_name text,
  p_account_no text,
  p_account_name text,
  p_wallet_type text DEFAULT 'hustler'
)
RETURNS public.withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_balance public.balances%ROWTYPE;
  v_controls public.platform_settings%ROWTYPE;
  v_wallet_amount numeric(12,2);
  v_pending numeric(12,2);
  v_reserved numeric(12,2);
  v_minimum numeric(12,2);
  v_maximum numeric(12,2);
  v_enabled boolean;
  v_schedule_days smallint[];
  v_window_start time;
  v_window_end time;
  v_timezone text;
  v_local_now timestamp without time zone;
  v_plan_code text;
  v_hustles integer;
  v_available_hustles integer;
  v_level integer;
  v_referrals integer;
  v_streak integer;
  v_online_minutes integer;
  v_interactions integer;
  v_withdrawal public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_wallet_type NOT IN ('hustler', 'referral') THEN RAISE EXCEPTION 'Invalid wallet type'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_profile.account_status <> 'active' THEN RAISE EXCEPTION 'This account is not active'; END IF;
  SELECT * INTO v_controls FROM public.platform_settings WHERE singleton;
  SELECT minimum_amount, enabled INTO v_minimum, v_enabled FROM public.payout_settings WHERE singleton;
  IF NOT COALESCE(v_enabled, false) THEN RAISE EXCEPTION 'Withdrawals are currently disabled until the next payout window'; END IF;
  IF (p_wallet_type = 'hustler' AND NOT v_controls.hustler_withdrawals_enabled)
    OR (p_wallet_type = 'referral' AND NOT v_controls.referral_withdrawals_enabled) THEN
    RAISE EXCEPTION '%', v_controls.withdrawal_failure_message;
  END IF;
  IF p_wallet_type = 'hustler' THEN
    v_schedule_days := v_controls.hustler_payout_days;
    v_window_start := v_controls.hustler_window_start;
    v_window_end := v_controls.hustler_window_end;
    v_timezone := v_controls.hustler_timezone;
  ELSE
    v_schedule_days := v_controls.referral_payout_days;
    v_window_start := v_controls.referral_window_start;
    v_window_end := v_controls.referral_window_end;
    v_timezone := v_controls.referral_timezone;
  END IF;
  v_local_now := now() AT TIME ZONE v_timezone;
  IF NOT (extract(dow FROM v_local_now)::smallint = ANY(v_schedule_days))
    OR v_local_now::time < v_window_start OR v_local_now::time > v_window_end THEN
    RAISE EXCEPTION '%', v_controls.withdrawal_failure_message;
  END IF;
  IF p_amount IS NULL OR p_amount < COALESCE(v_minimum, 500) OR p_amount >= 10000000000 THEN
    RAISE EXCEPTION 'Withdrawal does not meet the minimum amount';
  END IF;
  IF length(btrim(COALESCE(p_bank_name, ''))) NOT BETWEEN 1 AND 100
    OR p_account_no !~ '^[0-9]{10}$'
    OR length(btrim(COALESCE(p_account_name, ''))) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Enter valid bank and account details';
  END IF;

  SELECT plan_code INTO v_plan_code FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'active' AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY starts_at DESC LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');
  SELECT max_withdrawal INTO v_maximum FROM public.subscription_plans WHERE plan_code = v_plan_code;
  IF p_amount > COALESCE(v_maximum, 500) THEN
    RAISE EXCEPTION 'This plan allows withdrawals up to ₦% per request', to_char(COALESCE(v_maximum, 500), 'FM999,999,999,990.00');
  END IF;

  SELECT * INTO v_balance FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  v_wallet_amount := CASE WHEN p_wallet_type = 'hustler' THEN v_balance.reward_balance ELSE v_balance.referral_balance END;
  SELECT COALESCE(sum(amount), 0) INTO v_pending FROM public.withdrawals
  WHERE user_id = auth.uid() AND status = 'pending' AND wallet_type = p_wallet_type;
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now();
  IF v_wallet_amount - v_pending - (CASE WHEN p_wallet_type = 'hustler' THEN v_reserved ELSE 0 END) < p_amount THEN
    RAISE EXCEPTION 'Insufficient available wallet balance';
  END IF;

  SELECT count(*) INTO v_hustles FROM public.task_completions WHERE user_id = auth.uid() AND status = 'approved';
  IF v_hustles < v_controls.minimum_hustles THEN RAISE EXCEPTION '%', v_controls.withdrawal_failure_message; END IF;
  IF v_controls.require_all_hustles AND EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.is_active AND t.is_funded
      AND NOT EXISTS (SELECT 1 FROM public.task_completions c WHERE c.user_id = auth.uid() AND c.task_id = t.id AND c.status = 'approved')
  ) THEN RAISE EXCEPTION '%', v_controls.withdrawal_failure_message; END IF;
  v_level := CASE WHEN v_hustles >= 1000 THEN 6 WHEN v_hustles >= 500 THEN 5 WHEN v_hustles >= 100 THEN 4 WHEN v_hustles >= 50 THEN 3 WHEN v_hustles >= 25 THEN 2 WHEN v_hustles >= 10 THEN 1 ELSE 0 END;
  IF v_level < v_controls.minimum_hustle_level THEN RAISE EXCEPTION '%', v_controls.withdrawal_failure_message; END IF;
  SELECT count(*) INTO v_referrals FROM public.referrals WHERE referrer_id = auth.uid();
  IF v_referrals < v_controls.minimum_referrals THEN RAISE EXCEPTION '%', v_controls.withdrawal_failure_message; END IF;
  SELECT CASE WHEN checkin_date >= current_date - 1 THEN streak ELSE 0 END INTO v_streak
  FROM public.daily_checkins WHERE user_id = auth.uid() ORDER BY checkin_date DESC LIMIT 1;
  IF COALESCE(v_streak, 0) < v_controls.minimum_checkin_streak THEN RAISE EXCEPTION '%', v_controls.withdrawal_failure_message; END IF;
  SELECT COALESCE(sum(online_seconds) / 60, 0), COALESCE(sum(interactions), 0)
    INTO v_online_minutes, v_interactions FROM public.user_activity_daily
  WHERE user_id = auth.uid() AND activity_date >= current_date - (v_controls.measurement_days - 1);
  IF v_online_minutes < v_controls.minimum_online_minutes OR v_interactions < v_controls.minimum_interactions THEN
    RAISE EXCEPTION '%', v_controls.withdrawal_failure_message;
  END IF;

  INSERT INTO public.withdrawals (user_id, amount, bank_name, account_no, account_name, wallet_type)
  VALUES (auth.uid(), p_amount, btrim(p_bank_name), p_account_no, btrim(p_account_name), p_wallet_type)
  RETURNING * INTO v_withdrawal;
  RETURN v_withdrawal;
END;
$$;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text, text, text, text) FROM PUBLIC, anon;

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
  v_balance numeric(12,2);
  v_other_pending numeric(12,2);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_status NOT IN ('paid', 'rejected') THEN RAISE EXCEPTION 'Status must be paid or rejected'; END IF;
  IF p_status = 'paid' AND length(btrim(COALESCE(p_transaction_reference, ''))) = 0 THEN RAISE EXCEPTION 'A transaction reference is required for payouts'; END IF;
  IF length(COALESCE(p_transaction_reference, '')) > 150 THEN RAISE EXCEPTION 'Transaction reference must be 150 characters or fewer'; END IF;
  SELECT * INTO v_withdrawal FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR v_withdrawal.status <> 'pending' THEN RAISE EXCEPTION 'Pending withdrawal not found'; END IF;

  IF p_status = 'paid' THEN
    IF v_withdrawal.wallet_type = 'referral' THEN
      SELECT referral_balance INTO v_balance FROM public.balances WHERE user_id = v_withdrawal.user_id FOR UPDATE;
    ELSE
      SELECT reward_balance INTO v_balance FROM public.balances WHERE user_id = v_withdrawal.user_id FOR UPDATE;
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_other_pending FROM public.withdrawals
    WHERE user_id = v_withdrawal.user_id AND status = 'pending' AND wallet_type = v_withdrawal.wallet_type AND id <> p_withdrawal_id;
    IF v_balance - v_other_pending < v_withdrawal.amount THEN RAISE EXCEPTION 'Wallet no longer covers this withdrawal and its existing requests'; END IF;
    IF v_withdrawal.wallet_type = 'referral' THEN
      UPDATE public.balances SET referral_balance = referral_balance - v_withdrawal.amount, updated_at = now() WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (v_withdrawal.user_id, auth.uid(), 'referral', -v_withdrawal.amount, v_balance, v_balance - v_withdrawal.amount, 'Paid referral withdrawal ' || p_withdrawal_id::text);
    ELSE
      UPDATE public.balances SET reward_balance = reward_balance - v_withdrawal.amount, updated_at = now() WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
      VALUES (v_withdrawal.user_id, auth.uid(), 'reward', -v_withdrawal.amount, v_balance, v_balance - v_withdrawal.amount, 'Paid hustler withdrawal ' || p_withdrawal_id::text);
    END IF;
  END IF;

  UPDATE public.withdrawals SET status = p_status, transaction_reference = NULLIF(btrim(p_transaction_reference), ''), processed_at = now(), processed_by = auth.uid()
  WHERE id = p_withdrawal_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_withdrawal(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_withdrawal(uuid, text, text) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.referral_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  reward_type text NOT NULL CHECK (reward_type IN ('signup', 'first_hustle')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referral_id, reward_type)
);
ALTER TABLE public.referral_reward_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_reward_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pay_referral_signup_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric(12,2);
  v_before numeric(12,2);
  v_event uuid;
BEGIN
  SELECT referral_signup_reward INTO v_amount FROM public.platform_settings WHERE singleton;
  IF COALESCE(v_amount, 0) <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.referral_reward_events (referral_id, reward_type, amount)
  VALUES (NEW.id, 'signup', v_amount) ON CONFLICT DO NOTHING RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN NEW; END IF;
  SELECT referral_balance INTO v_before FROM public.balances WHERE user_id = NEW.referrer_id FOR UPDATE;
  UPDATE public.balances SET referral_balance = referral_balance + v_amount, total_earned = total_earned + v_amount, updated_at = now() WHERE user_id = NEW.referrer_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (NEW.referrer_id, NEW.referrer_id, 'referral', v_amount, v_before, v_before + v_amount, 'Referral signup reward');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pay_referral_signup_reward ON public.referrals;
CREATE TRIGGER pay_referral_signup_reward AFTER INSERT ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.pay_referral_signup_reward();

CREATE OR REPLACE FUNCTION public.pay_referral_first_hustle_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_amount numeric(12,2);
  v_before numeric(12,2);
  v_event uuid;
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN RETURN NEW; END IF;
  SELECT * INTO v_referral FROM public.referrals WHERE referred_id = NEW.user_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT referral_first_hustle_reward INTO v_amount FROM public.platform_settings WHERE singleton;
  IF COALESCE(v_amount, 0) <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.referral_reward_events (referral_id, reward_type, amount)
  VALUES (v_referral.id, 'first_hustle', v_amount) ON CONFLICT DO NOTHING RETURNING id INTO v_event;
  IF v_event IS NULL THEN RETURN NEW; END IF;
  SELECT referral_balance INTO v_before FROM public.balances WHERE user_id = v_referral.referrer_id FOR UPDATE;
  UPDATE public.balances SET referral_balance = referral_balance + v_amount, total_earned = total_earned + v_amount, updated_at = now() WHERE user_id = v_referral.referrer_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (v_referral.referrer_id, v_referral.referrer_id, 'referral', v_amount, v_before, v_before + v_amount, 'Referral first-hustle reward');
  UPDATE public.referrals SET bonus_paid = true WHERE id = v_referral.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pay_referral_first_hustle_reward ON public.task_completions;
CREATE TRIGGER pay_referral_first_hustle_reward AFTER INSERT OR UPDATE OF status ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.pay_referral_first_hustle_reward();

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_review_mode text NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_settings'::regclass AND conname = 'platform_settings_auto_review_mode_check') THEN
    ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_auto_review_mode_check CHECK (auto_review_mode IN ('manual', 'approve', 'reject')) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_auto_hustle_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mode text;
  v_reward numeric(12,2);
  v_before numeric(12,2);
BEGIN
  IF NEW.status <> 'pending' OR (TG_OP = 'UPDATE' AND OLD.status <> 'rejected') THEN RETURN NEW; END IF;
  SELECT auto_review_mode INTO v_mode FROM public.platform_settings WHERE singleton;
  IF COALESCE(v_mode, 'manual') = 'manual' THEN RETURN NEW; END IF;
  IF v_mode = 'reject' THEN
    UPDATE public.task_completions SET status = 'rejected', review_note = 'Automatically rejected by platform settings', reviewed_at = now()
    WHERE id = NEW.id;
    RETURN NEW;
  END IF;
  SELECT reward INTO v_reward FROM public.tasks WHERE id = NEW.task_id;
  SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User wallet not found'; END IF;
  UPDATE public.task_completions SET status = 'approved', review_note = 'Automatically approved by platform settings', reviewed_at = now()
  WHERE id = NEW.id;
  UPDATE public.balances SET reward_balance = reward_balance + v_reward, total_earned = total_earned + v_reward, updated_at = now()
  WHERE user_id = NEW.user_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (NEW.user_id, NEW.user_id, 'reward', v_reward, v_before, v_before + v_reward, 'Automatically approved hustle submission ' || NEW.id::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS apply_auto_hustle_review ON public.task_completions;
CREATE TRIGGER apply_auto_hustle_review AFTER INSERT OR UPDATE OF status ON public.task_completions
FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION public.apply_auto_hustle_review();

CREATE OR REPLACE FUNCTION public.admin_set_auto_review_mode(p_mode text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_completion_id uuid;
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_mode NOT IN ('manual', 'approve', 'reject') THEN RAISE EXCEPTION 'Invalid review mode'; END IF;
  UPDATE public.platform_settings SET auto_review_mode = p_mode, updated_at = now(), updated_by = auth.uid() WHERE singleton;
  IF p_mode = 'manual' THEN RETURN 0; END IF;
  FOR v_completion_id IN SELECT id FROM public.task_completions WHERE status = 'pending' ORDER BY completed_at FOR UPDATE LOOP
    PERFORM public.admin_review_task_completion(
      v_completion_id,
      CASE p_mode WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
      'Reviewed by global ' || p_mode || ' setting'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_auto_review_mode(text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_auto_review_mode(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_user_details(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  SELECT jsonb_build_object(
    'user_id', p.user_id,
    'username', p.username,
    'full_name', p.full_name,
    'phone', p.phone,
    'email', u.email,
    'joined_at', p.joined_at,
    'account_status', p.account_status,
    'login_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('ip_address', l.ip_address, 'user_agent', l.user_agent, 'created_at', l.created_at) ORDER BY l.created_at DESC) FROM public.user_login_history l WHERE l.user_id = p.user_id), '[]'::jsonb),
    'referred_users', COALESCE((SELECT jsonb_agg(jsonb_build_object('username', referred.username, 'joined_at', referred.joined_at, 'user_id', referred.user_id) ORDER BY referred.joined_at DESC) FROM public.referrals r JOIN public.profiles referred ON referred.user_id = r.referred_id WHERE r.referrer_id = p.user_id), '[]'::jsonb),
    'ip_matches', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', other.user_id, 'username', other.username, 'ip_address', l.ip_address)) FROM public.user_login_history l JOIN public.user_login_history ol ON ol.ip_address = l.ip_address AND ol.user_id <> l.user_id JOIN public.profiles other ON other.user_id = ol.user_id WHERE l.user_id = p.user_id), '[]'::jsonb)
  ) INTO v_result
  FROM public.profiles p JOIN auth.users u ON u.id = p.user_id WHERE p.user_id = p_user_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'User was not found'; END IF;
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_user_details(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_user_details(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.set_custom_referral_code(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_code !~ '^[A-Z0-9]{4,16}$' THEN RAISE EXCEPTION 'Use 4-16 letters or numbers for your custom code'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_subscriptions s JOIN public.subscription_plans p USING (plan_code)
    WHERE s.user_id = auth.uid() AND s.status = 'active' AND p.price > 0
      AND s.starts_at <= now() AND (s.ends_at IS NULL OR s.ends_at > now())
  ) THEN RAISE EXCEPTION 'Custom referral codes are available to premium hustlers'; END IF;
  IF NOT public.user_feature_enabled(auth.uid(), 'custom-referral-code') THEN RAISE EXCEPTION 'Custom referral codes are not available for your plan'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_code AND user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'That referral code is already in use';
  END IF;
  UPDATE public.profiles SET referral_code = v_code WHERE user_id = auth.uid();
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_custom_referral_code(text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_custom_referral_code(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.transfer_earnings_to_user(p_recipient text, p_amount numeric)
RETURNS public.balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id uuid;
  v_sender_before numeric(12,2);
  v_recipient_before numeric(12,2);
  v_pending numeric(12,2);
  v_reserved numeric(12,2);
  v_sender public.balances%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.user_feature_enabled(auth.uid(), 'transfers') THEN RAISE EXCEPTION 'Transfers are not available for your plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 10000000000 OR round(p_amount, 2) <> p_amount THEN RAISE EXCEPTION 'Enter a valid transfer amount'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_subscriptions s JOIN public.subscription_plans p USING (plan_code)
    WHERE s.user_id = auth.uid() AND s.status = 'active' AND p.price > 0
      AND s.starts_at <= now() AND (s.ends_at IS NULL OR s.ends_at > now())
  ) THEN RAISE EXCEPTION 'Transfers are available to premium hustlers'; END IF;
  SELECT user_id INTO v_recipient_id FROM public.profiles
  WHERE account_status = 'active' AND (lower(username) = lower(btrim(p_recipient)) OR referral_code = upper(btrim(p_recipient)))
  LIMIT 1;
  IF v_recipient_id IS NULL THEN RAISE EXCEPTION 'No active hustler matches that username or referral code'; END IF;
  IF v_recipient_id = auth.uid() THEN RAISE EXCEPTION 'Choose another hustler as the recipient'; END IF;
  PERFORM user_id FROM public.balances WHERE user_id IN (auth.uid(), v_recipient_id) ORDER BY user_id FOR UPDATE;
  SELECT reward_balance INTO v_sender_before FROM public.balances WHERE user_id = auth.uid();
  SELECT reward_balance INTO v_recipient_before FROM public.balances WHERE user_id = v_recipient_id;
  SELECT COALESCE(sum(amount), 0) INTO v_pending FROM public.withdrawals
  WHERE user_id = auth.uid() AND status = 'pending' AND wallet_type = 'hustler';
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved FROM public.user_subscriptions
  WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now();
  IF v_sender_before - v_pending - v_reserved < p_amount THEN RAISE EXCEPTION 'Insufficient available Hustler Wallet balance'; END IF;
  UPDATE public.balances SET reward_balance = reward_balance - p_amount, updated_at = now() WHERE user_id = auth.uid();
  UPDATE public.balances SET reward_balance = reward_balance + p_amount, updated_at = now() WHERE user_id = v_recipient_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (auth.uid(), auth.uid(), 'reward', -p_amount, v_sender_before, v_sender_before - p_amount, 'Transfer to user ' || v_recipient_id::text);
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (v_recipient_id, auth.uid(), 'reward', p_amount, v_recipient_before, v_recipient_before + p_amount, 'Transfer from user ' || auth.uid()::text);
  SELECT * INTO v_sender FROM public.balances WHERE user_id = auth.uid();
  RETURN v_sender;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_earnings_to_user(text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_earnings_to_user(text, numeric) FROM PUBLIC, anon;

ALTER TABLE public.balances ADD COLUMN IF NOT EXISTS fund_balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (fund_balance >= 0);
ALTER TABLE public.wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_balance_type_check;
ALTER TABLE public.wallet_ledger ADD CONSTRAINT wallet_ledger_balance_type_check CHECK (balance_type IN ('reward', 'referral', 'fund'));
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS campaign_budget_remaining numeric(12,2) CHECK (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= 0),
  ADD COLUMN IF NOT EXISTS campaign_submission_id uuid;

CREATE TABLE IF NOT EXISTS public.campaign_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 4 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  category text NOT NULL CHECK (length(category) BETWEEN 2 AND 80),
  reward numeric(10,2) NOT NULL CHECK (reward > 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  budget numeric(12,2) NOT NULL CHECK (budget > 0),
  task_url text NOT NULL CHECK (task_url ~ '^https?://'),
  proof_instructions text NOT NULL CHECK (length(proof_instructions) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campaign_submissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.campaign_submissions TO authenticated;
DROP POLICY IF EXISTS users_read_own_campaign_submissions ON public.campaign_submissions;
CREATE POLICY users_read_own_campaign_submissions ON public.campaign_submissions FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS admins_read_campaign_submissions ON public.campaign_submissions;
CREATE POLICY admins_read_campaign_submissions ON public.campaign_submissions FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.submit_campaign(
  p_title text,
  p_description text,
  p_category text,
  p_reward numeric,
  p_quantity integer,
  p_task_url text,
  p_proof_instructions text
)
RETURNS public.campaign_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fund_balance numeric(12,2);
  v_pending_budget numeric(12,2);
  v_budget numeric(12,2);
  v_submission public.campaign_submissions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  IF length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 4 AND 120
    OR length(btrim(COALESCE(p_description, ''))) NOT BETWEEN 10 AND 2000
    OR length(btrim(COALESCE(p_category, ''))) NOT BETWEEN 2 AND 80
    OR length(btrim(COALESCE(p_proof_instructions, ''))) NOT BETWEEN 5 AND 1000
    OR COALESCE(p_task_url, '') !~ '^https?://' THEN RAISE EXCEPTION 'Complete every campaign field with a valid URL'; END IF;
  IF p_reward IS NULL OR p_reward <= 0 OR p_quantity NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Enter a valid reward and quantity'; END IF;
  v_budget := p_reward * p_quantity;
  IF v_budget >= 10000000000 THEN RAISE EXCEPTION 'Campaign budget is too large'; END IF;
  SELECT fund_balance INTO v_fund_balance FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fund Wallet not found'; END IF;
  SELECT COALESCE(sum(budget), 0) INTO v_pending_budget FROM public.campaign_submissions WHERE user_id = auth.uid() AND status = 'pending';
  IF v_fund_balance - v_pending_budget < v_budget THEN RAISE EXCEPTION 'Insufficient available Fund Wallet balance'; END IF;
  INSERT INTO public.campaign_submissions (user_id, title, description, category, reward, quantity, budget, task_url, proof_instructions)
  VALUES (auth.uid(), btrim(p_title), btrim(p_description), btrim(p_category), p_reward, p_quantity, v_budget, btrim(p_task_url), btrim(p_proof_instructions))
  RETURNING * INTO v_submission;
  RETURN v_submission;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_campaign(text, text, text, numeric, integer, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_campaign(text, text, text, numeric, integer, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_review_campaign_submission(p_submission_id uuid, p_decision text, p_review_note text DEFAULT NULL)
RETURNS public.campaign_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission public.campaign_submissions%ROWTYPE;
  v_fund_before numeric(12,2);
  v_task_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Invalid campaign decision'; END IF;
  IF length(COALESCE(p_review_note, '')) > 500 THEN RAISE EXCEPTION 'Review note is too long'; END IF;
  SELECT * INTO v_submission FROM public.campaign_submissions WHERE id = p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'pending' THEN RAISE EXCEPTION 'Pending campaign submission not found'; END IF;
  IF p_decision = 'approve' THEN
    SELECT fund_balance INTO v_fund_before FROM public.balances WHERE user_id = v_submission.user_id FOR UPDATE;
    IF v_fund_before < v_submission.budget THEN RAISE EXCEPTION 'Fund Wallet no longer covers this campaign'; END IF;
    UPDATE public.balances SET fund_balance = fund_balance - v_submission.budget, updated_at = now() WHERE user_id = v_submission.user_id;
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (v_submission.user_id, auth.uid(), 'fund', -v_submission.budget, v_fund_before, v_fund_before - v_submission.budget, 'Campaign funding ' || v_submission.id::text);
    INSERT INTO public.tasks (title, description, category, reward, difficulty, is_active, task_url, daily_quota, proof_required, proof_instructions, sort_order, is_funded, required_plan_code, verification_mode, campaign_budget_remaining, campaign_submission_id)
    VALUES (v_submission.title, v_submission.description, v_submission.category, v_submission.reward, 'Standard', true, v_submission.task_url, v_submission.quantity, true, v_submission.proof_instructions, (SELECT COALESCE(max(sort_order), 0) + 1 FROM public.tasks), true, 'free', 'manual', v_submission.budget, v_submission.id)
    RETURNING id INTO v_task_id;
    UPDATE public.campaign_submissions SET status = 'approved', task_id = v_task_id, review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_submission.id;
  ELSE
    UPDATE public.campaign_submissions SET status = 'rejected', review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_submission.id;
  END IF;
  SELECT * INTO v_submission FROM public.campaign_submissions WHERE id = p_submission_id;
  RETURN v_submission;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_campaign_submission(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_campaign_submission(uuid, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.charge_campaign_hustle_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reward numeric(12,2);
  v_remaining numeric(12,2);
  v_pending integer;
  v_started integer;
  v_required integer;
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN RETURN NEW; END IF;
  SELECT reward, campaign_budget_remaining INTO v_reward, v_remaining FROM public.tasks WHERE id = NEW.task_id AND campaign_budget_remaining IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_pending FROM public.task_completions WHERE task_id = NEW.task_id AND status = 'pending';
  SELECT count(*) INTO v_started FROM public.task_verification_sessions WHERE task_id = NEW.task_id AND status = 'started' AND expires_at > now();
  v_required := v_pending + v_started;
  IF v_started = 0 THEN v_required := v_required + 1; END IF;
  IF v_remaining < v_reward * v_required THEN RAISE EXCEPTION 'Campaign funds are reserved for active submissions'; END IF;
  UPDATE public.tasks SET campaign_budget_remaining = campaign_budget_remaining - v_reward,
    is_active = CASE WHEN campaign_budget_remaining - v_reward < v_reward THEN false ELSE is_active END
  WHERE id = NEW.task_id AND campaign_budget_remaining >= v_reward;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign funds are exhausted'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS charge_campaign_hustle_reward ON public.task_completions;
CREATE TRIGGER charge_campaign_hustle_reward AFTER INSERT OR UPDATE OF status ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.charge_campaign_hustle_reward();

CREATE OR REPLACE FUNCTION public.admin_review_funding_deposit(p_deposit_id uuid, p_decision text, p_review_note text DEFAULT NULL)
RETURNS public.funding_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deposit public.funding_deposits%ROWTYPE;
  v_balance numeric(12,2);
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_decision NOT IN ('confirm', 'reject') THEN RAISE EXCEPTION 'Invalid funding decision'; END IF;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_deposit.status <> 'pending' THEN RAISE EXCEPTION 'Pending funding deposit not found'; END IF;
  IF p_decision = 'confirm' THEN
    SELECT fund_balance INTO v_balance FROM public.balances WHERE user_id = v_deposit.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'User Fund Wallet not found'; END IF;
    UPDATE public.balances SET fund_balance = fund_balance + v_deposit.amount, updated_at = now() WHERE user_id = v_deposit.user_id;
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (v_deposit.user_id, auth.uid(), 'fund', v_deposit.amount, v_balance, v_balance + v_deposit.amount, 'Confirmed Fund Wallet deposit ' || v_deposit.id::text);
    UPDATE public.funding_deposits SET status = 'confirmed', review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_deposit.id;
  ELSE
    UPDATE public.funding_deposits SET status = 'rejected', review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_deposit.id;
  END IF;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE id = p_deposit_id;
  RETURN v_deposit;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_gateway_funding(p_provider_reference text)
RETURNS public.funding_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deposit public.funding_deposits%ROWTYPE;
  v_balance numeric(12,2);
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required'; END IF;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE provider_reference = p_provider_reference FOR UPDATE;
  IF NOT FOUND OR v_deposit.status <> 'pending' OR v_deposit.payment_method = 'manual' THEN RAISE EXCEPTION 'Pending gateway deposit not found'; END IF;
  SELECT fund_balance INTO v_balance FROM public.balances WHERE user_id = v_deposit.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User Fund Wallet not found'; END IF;
  UPDATE public.balances SET fund_balance = fund_balance + v_deposit.amount, updated_at = now() WHERE user_id = v_deposit.user_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (v_deposit.user_id, v_deposit.user_id, 'fund', v_deposit.amount, v_balance, v_balance + v_deposit.amount, 'Confirmed gateway Fund Wallet deposit ' || v_deposit.id::text);
  UPDATE public.funding_deposits SET status = 'confirmed', reviewed_at = now() WHERE id = v_deposit.id;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE id = v_deposit.id;
  RETURN v_deposit;
END;
$$;

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
  v_fund numeric(12,2);
  v_hustler_pending numeric(12,2);
  v_referral_pending numeric(12,2);
  v_ledger_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_balance_type NOT IN ('reward', 'referral', 'fund') THEN RAISE EXCEPTION 'Invalid balance type'; END IF;
  IF p_amount = 0 OR abs(p_amount) >= 10000000000 THEN RAISE EXCEPTION 'Adjustment amount is out of range'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'A reason of 1 to 500 characters is required'; END IF;
  SELECT reward_balance, referral_balance, fund_balance INTO v_reward, v_referral, v_fund
  FROM public.balances WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User balance not found'; END IF;
  v_before := CASE p_balance_type WHEN 'reward' THEN v_reward WHEN 'referral' THEN v_referral ELSE v_fund END;
  v_after := v_before + p_amount;
  IF v_after < 0 OR v_after >= 10000000000 THEN RAISE EXCEPTION 'Adjustment would put the balance out of range'; END IF;
  IF p_balance_type = 'reward' THEN v_reward := v_after; ELSIF p_balance_type = 'referral' THEN v_referral := v_after; ELSE v_fund := v_after; END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE wallet_type = 'hustler'), 0), COALESCE(sum(amount) FILTER (WHERE wallet_type = 'referral'), 0)
    INTO v_hustler_pending, v_referral_pending FROM public.withdrawals WHERE user_id = p_user_id AND status = 'pending';
  IF v_reward < v_hustler_pending OR v_referral < v_referral_pending THEN RAISE EXCEPTION 'Adjustment would leave pending withdrawals unfunded'; END IF;
  UPDATE public.balances SET reward_balance = v_reward, referral_balance = v_referral, fund_balance = v_fund, updated_at = now() WHERE user_id = p_user_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (p_user_id, auth.uid(), p_balance_type, p_amount, v_before, v_after, btrim(p_reason)) RETURNING id INTO v_ledger_id;
  RETURN v_ledger_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid, text, numeric, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_reorder_tasks(p_task_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_task_ids IS NULL OR cardinality(p_task_ids) = 0
    OR cardinality(p_task_ids) <> (SELECT count(DISTINCT value) FROM unnest(p_task_ids) AS ids(value))
    OR cardinality(p_task_ids) <> (SELECT count(*) FROM public.tasks) THEN
    RAISE EXCEPTION 'The reorder list must include every hustle exactly once';
  END IF;
  UPDATE public.tasks AS task SET sort_order = ordered.position::integer
  FROM unnest(p_task_ids) WITH ORDINALITY AS ordered(task_id, position)
  WHERE task.id = ordered.task_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> cardinality(p_task_ids) THEN RAISE EXCEPTION 'Hustle catalog changed during reorder'; END IF;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_reorder_tasks(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_reorder_tasks(uuid[]) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  title text NOT NULL DEFAULT 'Welcome to Mr Hustle',
  message text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  welcome_bonus numeric(12,2) NOT NULL DEFAULT 0 CHECK (welcome_bonus >= 0),
  require_social boolean NOT NULL DEFAULT false,
  social_links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(social_links) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.platform_announcements TO authenticated;
GRANT INSERT, UPDATE ON public.platform_announcements TO authenticated;
DROP POLICY IF EXISTS members_read_active_announcement ON public.platform_announcements;
CREATE POLICY members_read_active_announcement ON public.platform_announcements FOR SELECT TO authenticated USING (enabled);
DROP POLICY IF EXISTS admins_manage_announcement ON public.platform_announcements;
CREATE POLICY admins_manage_announcement ON public.platform_announcements FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.platform_announcements (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.welcome_bonus_claims (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.welcome_bonus_claims ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.welcome_bonus_claims TO authenticated;
DROP POLICY IF EXISTS users_read_own_welcome_claim ON public.welcome_bonus_claims;
CREATE POLICY users_read_own_welcome_claim ON public.welcome_bonus_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_welcome_bonus(p_social_confirmed boolean DEFAULT false)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_announcement public.platform_announcements%ROWTYPE;
  v_before numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN RAISE EXCEPTION 'This account is not active'; END IF;
  SELECT * INTO v_announcement FROM public.platform_announcements WHERE singleton AND enabled FOR UPDATE;
  IF NOT FOUND OR v_announcement.welcome_bonus <= 0 THEN RAISE EXCEPTION 'No welcome bonus is currently available'; END IF;
  IF v_announcement.require_social AND (NOT COALESCE(p_social_confirmed, false) OR jsonb_array_length(v_announcement.social_links) = 0) THEN
    RAISE EXCEPTION 'Join the official social channels and confirm before claiming';
  END IF;
  INSERT INTO public.welcome_bonus_claims (user_id, amount) VALUES (auth.uid(), v_announcement.welcome_bonus)
  ON CONFLICT (user_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'Welcome bonus has already been claimed'; END IF;
  SELECT reward_balance INTO v_before FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  UPDATE public.balances SET reward_balance = reward_balance + v_announcement.welcome_bonus, total_earned = total_earned + v_announcement.welcome_bonus, updated_at = now() WHERE user_id = auth.uid();
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (auth.uid(), auth.uid(), 'reward', v_announcement.welcome_bonus, v_before, v_before + v_announcement.welcome_bonus, 'Welcome bonus claim');
  RETURN v_announcement.welcome_bonus;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_welcome_bonus(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_welcome_bonus(boolean) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.user_feature_enabled(p_user_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_premium boolean;
  v_enabled boolean;
BEGIN
  IF public.is_admin() THEN RETURN true; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_subscriptions s JOIN public.subscription_plans p USING (plan_code)
    WHERE s.user_id = p_user_id AND s.status = 'active' AND p.price > 0
      AND s.starts_at <= now() AND (s.ends_at IS NULL OR s.ends_at > now())
  ) INTO v_premium;
  SELECT CASE WHEN v_premium THEN premium_enabled ELSE free_enabled END INTO v_enabled
  FROM public.feature_permissions WHERE feature_key = p_feature_key;
  RETURN COALESCE(v_enabled, true);
END;
$$;
REVOKE ALL ON FUNCTION public.user_feature_enabled(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_hustle_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.user_feature_enabled(NEW.user_id, 'hustles') THEN RAISE EXCEPTION 'Hustles are not available for your plan'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_hustle_feature ON public.task_completions;
CREATE TRIGGER enforce_hustle_feature BEFORE INSERT ON public.task_completions
FOR EACH ROW EXECUTE FUNCTION public.enforce_hustle_feature();

CREATE OR REPLACE FUNCTION public.enforce_campaign_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.user_feature_enabled(NEW.user_id, 'campaigns') THEN RAISE EXCEPTION 'Campaign submissions are not available for your plan'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_campaign_feature ON public.campaign_submissions;
CREATE TRIGGER enforce_campaign_feature BEFORE INSERT ON public.campaign_submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_campaign_feature();

CREATE OR REPLACE FUNCTION public.skip_disabled_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.user_feature_enabled(NEW.referrer_id, 'referrals') THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS skip_disabled_referral ON public.referrals;
CREATE TRIGGER skip_disabled_referral BEFORE INSERT ON public.referrals
FOR EACH ROW EXECUTE FUNCTION public.skip_disabled_referral();

CREATE OR REPLACE FUNCTION public.get_leaderboard(p_category text DEFAULT 'earnings')
RETURNS TABLE ("position" integer, user_id uuid, display_name text, avatar_url text, score numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.user_feature_enabled(auth.uid(), 'leaderboard') THEN RAISE EXCEPTION 'Leaderboard is not available for your plan'; END IF;
  IF p_category NOT IN ('earnings', 'hustles', 'referrals') THEN RAISE EXCEPTION 'Invalid leaderboard category'; END IF;
  RETURN QUERY
  WITH scores AS (
    SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.leaderboard_opt_in,
      CASE p_category
        WHEN 'earnings' THEN COALESCE(b.total_earned, 0)
        WHEN 'hustles' THEN (SELECT count(*)::numeric FROM public.task_completions c WHERE c.user_id = p.user_id AND c.status = 'approved')
        ELSE (SELECT count(*)::numeric FROM public.referrals r WHERE r.referrer_id = p.user_id)
      END AS metric
    FROM public.profiles p LEFT JOIN public.balances b ON b.user_id = p.user_id
    WHERE p.account_status = 'active'
  ), ranked AS (
    SELECT row_number() OVER (ORDER BY metric DESC, user_id)::integer AS rank, * FROM scores WHERE metric > 0
  )
  SELECT ranked.rank,
    CASE WHEN public.is_admin() OR ranked.leaderboard_opt_in THEN ranked.user_id ELSE NULL::uuid END,
    CASE WHEN ranked.leaderboard_opt_in THEN COALESCE(NULLIF(ranked.full_name, ''), ranked.username)
      ELSE 'Hustler ' || substr(ranked.user_id::text, 1, 6) END,
    CASE WHEN ranked.leaderboard_opt_in THEN ranked.avatar_url ELSE NULL END,
    ranked.metric
  FROM ranked WHERE ranked.rank <= 20 ORDER BY ranked.rank;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_leaderboard(text) FROM PUBLIC, anon;

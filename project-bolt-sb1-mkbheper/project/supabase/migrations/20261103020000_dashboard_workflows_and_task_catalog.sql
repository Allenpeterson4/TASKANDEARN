ALTER TABLE public.payout_settings
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;

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
  v_enabled boolean;
  v_withdrawal public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;
  SELECT minimum_amount, enabled INTO v_minimum, v_enabled FROM public.payout_settings WHERE singleton;
  IF NOT COALESCE(v_enabled, false) THEN RAISE EXCEPTION 'Withdrawals are currently disabled until the next payout window'; END IF;
  IF p_amount < COALESCE(v_minimum, 5000) OR p_amount >= 10000000000 THEN
    RAISE EXCEPTION 'Withdrawal does not meet the minimum amount';
  END IF;
  IF length(btrim(COALESCE(p_bank_name, ''))) NOT BETWEEN 1 AND 100
    OR p_account_no !~ '^[0-9]{10}$'
    OR length(btrim(COALESCE(p_account_name, ''))) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Enter valid bank and account details';
  END IF;
  SELECT reward_balance, referral_balance INTO v_reward, v_referral FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_pending FROM public.withdrawals WHERE user_id = auth.uid() AND status = 'pending';
  SELECT COALESCE(sum(wallet_contribution), 0) INTO v_reserved_subscriptions FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now();
  IF v_reward + v_referral - v_reserved_subscriptions - v_pending < p_amount THEN RAISE EXCEPTION 'Insufficient available balance'; END IF;
  INSERT INTO public.withdrawals (user_id, amount, bank_name, account_no, account_name)
  VALUES (auth.uid(), p_amount, btrim(p_bank_name), p_account_no, btrim(p_account_name))
  RETURNING * INTO v_withdrawal;
  RETURN v_withdrawal;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_referral_balance()
RETURNS public.balances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance public.balances%ROWTYPE;
  v_amount numeric(12,2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_balance FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found'; END IF;
  v_amount := v_balance.referral_balance;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'No referral balance is available to transfer'; END IF;
  UPDATE public.balances
  SET reward_balance = reward_balance + v_amount, referral_balance = 0, updated_at = now()
  WHERE user_id = auth.uid()
  RETURNING * INTO v_balance;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (auth.uid(), auth.uid(), 'referral', -v_amount, v_amount, 0, 'Transferred referral earnings to reward balance');
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (auth.uid(), auth.uid(), 'reward', v_amount, v_balance.reward_balance - v_amount, v_balance.reward_balance, 'Received transferred referral earnings');
  RETURN v_balance;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_referral_balance() TO authenticated;
REVOKE ALL ON FUNCTION public.transfer_referral_balance() FROM PUBLIC, anon;

ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'wallet',
  ADD COLUMN IF NOT EXISTS payment_proof text;

UPDATE public.subscription_plans
SET description = CASE plan_code
  WHEN 'free' THEN 'Start earning with daily tasks and a simple wallet.'
  WHEN 'premium' THEN 'Unlock more daily tasks, higher earning limits, and better referral rates.'
  WHEN 'vip' THEN 'Get the highest task access, unlimited daily tasks, and no daily earning cap.'
  ELSE description
END
WHERE description = '';

CREATE OR REPLACE FUNCTION public.submit_manual_plan_payment(p_plan_code text, p_payment_proof text)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_subscription public.user_subscriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(btrim(COALESCE(p_payment_proof, ''))) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'Payment proof is required'; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE plan_code = p_plan_code AND is_active AND price > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paid plan is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'active' AND (ends_at IS NULL OR ends_at > now())) THEN RAISE EXCEPTION 'An active paid plan already exists'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now()) THEN RAISE EXCEPTION 'A plan payment is already awaiting review'; END IF;
  INSERT INTO public.user_subscriptions (user_id, plan_code, status, provider, provider_reference, amount, payment_method, payment_proof, expires_at)
  VALUES (auth.uid(), p_plan_code, 'pending', 'manual', 'MANUAL_' || replace(gen_random_uuid()::text, '-', ''), v_plan.price, 'manual', btrim(p_payment_proof), now() + interval '7 days')
  RETURNING * INTO v_subscription;
  RETURN v_subscription;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_manual_plan_payment(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_manual_plan_payment(text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_review_plan_subscription(p_subscription_id uuid, p_decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription public.user_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_decision NOT IN ('activate', 'decline') THEN RAISE EXCEPTION 'Invalid subscription decision'; END IF;
  SELECT * INTO v_subscription FROM public.user_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR v_subscription.status <> 'pending' THEN RAISE EXCEPTION 'Pending subscription not found'; END IF;
  IF p_decision = 'activate' THEN
    IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id = v_subscription.user_id AND status = 'active' AND (ends_at IS NULL OR ends_at > now())) THEN RAISE EXCEPTION 'User already has an active paid plan'; END IF;
    UPDATE public.user_subscriptions SET status = 'active', starts_at = now(), ends_at = now() + interval '30 days', expires_at = NULL WHERE id = p_subscription_id;
  ELSE
    UPDATE public.user_subscriptions SET status = 'cancelled', expires_at = now() WHERE id = p_subscription_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_plan_subscription(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_plan_subscription(uuid, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.submit_gateway_plan_payment(p_plan_code text, p_provider text)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_subscription public.user_subscriptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_provider NOT IN ('paystack', 'flutterwave') THEN RAISE EXCEPTION 'Unsupported payment provider'; END IF;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE plan_code = p_plan_code AND is_active AND price > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paid plan is unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'active' AND (ends_at IS NULL OR ends_at > now())) THEN RAISE EXCEPTION 'An active paid plan already exists'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id = auth.uid() AND status = 'pending' AND expires_at > now()) THEN RAISE EXCEPTION 'A plan payment is already awaiting confirmation'; END IF;
  INSERT INTO public.user_subscriptions (user_id, plan_code, status, provider, provider_reference, amount, payment_method, expires_at)
  VALUES (auth.uid(), p_plan_code, 'pending', p_provider, upper(p_provider) || '_' || replace(gen_random_uuid()::text, '-', ''), v_plan.price, p_provider, now() + interval '30 minutes')
  RETURNING * INTO v_subscription;
  RETURN v_subscription;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_gateway_plan_payment(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_gateway_plan_payment(text, text) FROM PUBLIC, anon;

WITH categories(category, description) AS (
  VALUES
    ('Social Media', 'Complete a genuine social media action for a funded campaign.'),
    ('Survey', 'Share honest feedback for a research campaign.'),
    ('Review', 'Review a product or service according to the campaign brief.'),
    ('App Install', 'Install and use a sponsored app according to the task brief.'),
    ('Data Entry', 'Complete a clear data entry task accurately.'),
    ('Video', 'Watch and respond to a sponsored video task.'
  )
), numbered AS (
  SELECT categories.*, generate_series(1, 50) AS task_number FROM categories
)
INSERT INTO public.tasks (title, description, category, reward, difficulty, is_active, task_url, daily_quota, proof_required, proof_instructions, sort_order, is_funded, required_plan_code, verification_mode)
SELECT
  category || ' Task ' || task_number,
  description,
  category,
  CASE WHEN task_number <= 15 THEN 50 ELSE 100 END,
  CASE WHEN task_number <= 15 THEN 'Easy' ELSE 'Standard' END,
  true,
  '',
  0,
  true,
  'Describe the completed action and upload proof if requested by the campaign.',
  task_number,
  true,
  CASE WHEN task_number <= 15 THEN 'free' WHEN task_number <= 35 THEN 'premium' ELSE 'vip' END,
  'manual'
FROM numbered
WHERE NOT EXISTS (SELECT 1 FROM public.tasks existing WHERE existing.title = category || ' Task ' || task_number);

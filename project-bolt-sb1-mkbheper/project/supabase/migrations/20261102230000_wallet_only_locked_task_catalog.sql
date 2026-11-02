ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS is_funded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS required_plan_code text NOT NULL DEFAULT 'free' REFERENCES public.subscription_plans(plan_code);

UPDATE public.tasks
SET is_funded = true
WHERE title NOT LIKE 'Draft %';

UPDATE public.tasks
SET is_active = true,
    is_funded = false,
    required_plan_code = CASE
      WHEN substring(title FROM '([0-9]{2})$')::integer >= 46 THEN 'vip'
      WHEN substring(title FROM '([0-9]{2})$')::integer >= 31 THEN 'premium'
      ELSE 'free'
    END
WHERE title LIKE 'Draft % Campaign __';

UPDATE public.tasks
SET description = description || ' Campaign context: ' ||
  CASE category
    WHEN 'Telegram Joins' THEN 'Brands sponsor relevant Telegram communities to introduce products, support channels, and updates to interested members.'
    WHEN 'WhatsApp Group Joins' THEN 'Businesses fund opt-in WhatsApp community discovery to provide customer education and useful product information.'
    WHEN 'Surveys' THEN 'Research sponsors pay for honest, eligible feedback that helps them understand customer needs and improve products.'
    WHEN 'Social Media Engagements' THEN 'Brands sponsor genuine awareness campaigns to introduce content to relevant audiences; artificial or misleading engagement is not eligible.'
    ELSE 'Campaign sponsors fund this action to reach people who may find the information useful.'
  END || ' These drafts are unfunded and cannot be claimed until an administrator configures the partner, requirements, verification, and campaign budget.'
WHERE title LIKE 'Draft % Campaign __';

DROP FUNCTION IF EXISTS public.reserve_plan_upgrade(text, numeric);
DROP FUNCTION IF EXISTS public.complete_plan_upgrade(text);

UPDATE public.user_subscriptions
SET status = 'cancelled', wallet_contribution = 0
WHERE status = 'pending' AND provider = 'paystack';

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
  v_plan_code text;
  v_required_rank integer;
  v_user_rank integer;
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
  IF NOT v_task.is_funded THEN
    RAISE EXCEPTION 'This campaign is being prepared and is not available yet';
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
    AND ends_at > now()
  ORDER BY starts_at DESC
  LIMIT 1;
  v_plan_code := COALESCE(v_plan_code, 'free');

  SELECT CASE plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_user_rank
  FROM public.subscription_plans WHERE plan_code = v_plan_code;
  SELECT CASE required_plan_code WHEN 'premium' THEN 1 WHEN 'vip' THEN 2 ELSE 0 END
  INTO v_required_rank
  FROM public.tasks WHERE id = p_task_id;
  IF v_user_rank < v_required_rank THEN
    RAISE EXCEPTION 'This task requires the % plan', initcap(v_task.required_plan_code);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE plan_code = v_task.required_plan_code AND is_active
  ) THEN
    RAISE EXCEPTION 'This plan is not currently available';
  END IF;

  SELECT daily_task_limit, daily_earning_cap
  INTO v_daily_limit, v_daily_earning_cap
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

CREATE OR REPLACE FUNCTION public.purchase_plan_with_wallet(
  p_plan_code text,
  p_reward_amount numeric DEFAULT 0,
  p_referral_amount numeric DEFAULT 0
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_subscription public.user_subscriptions%ROWTYPE;
  v_reward_balance numeric(12,2);
  v_referral_balance numeric(12,2);
  v_pending_withdrawals numeric(12,2);
  v_total_payment numeric(12,2);
  v_reference text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT * INTO v_profile FROM public.profiles
  WHERE user_id = auth.uid() AND account_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans
  WHERE plan_code = p_plan_code AND is_active AND price > 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This upgrade plan is unavailable';
  END IF;
  IF p_reward_amount IS NULL OR p_referral_amount IS NULL
    OR p_reward_amount < 0 OR p_referral_amount < 0
    OR round(p_reward_amount, 2) <> p_reward_amount
    OR round(p_referral_amount, 2) <> p_referral_amount THEN
    RAISE EXCEPTION 'Wallet contributions must be valid amounts with two decimals or fewer';
  END IF;

  v_total_payment := p_reward_amount + p_referral_amount;
  IF v_total_payment <> v_plan.price THEN
    RAISE EXCEPTION 'Reward and referral balances must cover the full plan price';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_subscriptions
    WHERE user_id = auth.uid() AND status = 'active' AND ends_at > now()
  ) THEN
    RAISE EXCEPTION 'An active paid plan already exists';
  END IF;

  SELECT reward_balance, referral_balance INTO v_reward_balance, v_referral_balance
  FROM public.balances WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_pending_withdrawals
  FROM public.withdrawals WHERE user_id = auth.uid() AND status = 'pending';
  IF v_reward_balance < p_reward_amount OR v_referral_balance < p_referral_amount
    OR v_reward_balance + v_referral_balance - v_total_payment < v_pending_withdrawals THEN
    RAISE EXCEPTION 'Insufficient available wallet balance';
  END IF;

  UPDATE public.balances
  SET reward_balance = reward_balance - p_reward_amount,
      referral_balance = referral_balance - p_referral_amount,
      updated_at = now()
  WHERE user_id = auth.uid();

  v_reference := 'WALLET_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.user_subscriptions (
    user_id, plan_code, status, provider, provider_reference, amount,
    wallet_contribution, starts_at, ends_at
  ) VALUES (
    auth.uid(), p_plan_code, 'active', 'wallet', v_reference, v_plan.price,
    v_total_payment, now(), now() + interval '30 days'
  ) RETURNING * INTO v_subscription;

  IF p_reward_amount > 0 THEN
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (auth.uid(), auth.uid(), 'reward', -p_reward_amount, v_reward_balance, v_reward_balance - p_reward_amount, 'Plan purchase ' || p_plan_code);
  END IF;
  IF p_referral_amount > 0 THEN
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (auth.uid(), auth.uid(), 'referral', -p_referral_amount, v_referral_balance, v_referral_balance - p_referral_amount, 'Plan purchase ' || p_plan_code);
  END IF;

  RETURN v_subscription;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_plan_with_wallet(text, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.purchase_plan_with_wallet(text, numeric, numeric) FROM PUBLIC, anon;

UPDATE public.subscription_plans SET is_active = true WHERE plan_code IN ('free', 'premium', 'vip');

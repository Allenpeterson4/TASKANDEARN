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
  WHERE provider IN ('paystack', 'flutterwave') AND provider_reference = p_reference
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
  SET status = 'active', starts_at = now(), ends_at = now() + interval '30 days', expires_at = NULL
  WHERE id = v_subscription.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_plan_upgrade(text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_plan_upgrade(text) FROM PUBLIC, anon, authenticated;

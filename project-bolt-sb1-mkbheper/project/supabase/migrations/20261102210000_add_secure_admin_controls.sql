-- Admins are assigned through Supabase Auth app_metadata by a trusted operator.
-- Never grant this claim through user-editable metadata or the client application.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role' = 'admin', false);
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;

-- Only profile fields intended for member editing remain writable by members.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, username, phone) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
CREATE POLICY "insert_own_profile" ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id AND tier = 'Bronze');

DROP POLICY IF EXISTS "admin_select_profiles" ON public.profiles;
CREATE POLICY "admin_select_profiles" ON public.profiles FOR SELECT
  TO authenticated USING (public.is_admin());

-- A member may create only an empty balance row; balance changes use audited RPCs.
DROP POLICY IF EXISTS "update_own_balance" ON public.balances;
DROP POLICY IF EXISTS "insert_own_balance" ON public.balances;
REVOKE UPDATE ON public.balances FROM authenticated;
CREATE POLICY "insert_zero_balance" ON public.balances FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND reward_balance = 0
    AND referral_balance = 0
    AND total_earned = 0
  );

DROP POLICY IF EXISTS "admin_select_balances" ON public.balances;
CREATE POLICY "admin_select_balances" ON public.balances FOR SELECT
  TO authenticated USING (public.is_admin());

-- Task configuration is public to read but writable only by admins.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS task_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS daily_quota integer NOT NULL DEFAULT 0 CHECK (daily_quota >= 0),
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proof_instructions text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_reward_nonnegative'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_reward_nonnegative CHECK (reward >= 0) NOT VALID;
  END IF;
END;
$$;

GRANT INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
DROP POLICY IF EXISTS "admin_manage_tasks" ON public.tasks;
CREATE POLICY "admin_manage_tasks" ON public.tasks FOR ALL
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Completion proof and review data are never directly writable by members.
ALTER TABLE public.task_completions
  ADD COLUMN IF NOT EXISTS proof_text text,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);

DROP POLICY IF EXISTS "insert_own_completions" ON public.task_completions;
REVOKE INSERT, UPDATE, DELETE ON public.task_completions FROM authenticated;
DROP POLICY IF EXISTS "admin_select_completions" ON public.task_completions;
CREATE POLICY "admin_select_completions" ON public.task_completions FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  balance_type text NOT NULL CHECK (balance_type IN ('reward', 'referral')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  balance_before numeric(12,2) NOT NULL,
  balance_after numeric(12,2) NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_ledger TO authenticated;
DROP POLICY IF EXISTS "select_own_wallet_ledger" ON public.wallet_ledger;
CREATE POLICY "select_own_wallet_ledger" ON public.wallet_ledger FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "admin_select_wallet_ledger" ON public.wallet_ledger;
CREATE POLICY "admin_select_wallet_ledger" ON public.wallet_ledger FOR SELECT
  TO authenticated USING (public.is_admin());

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS transaction_reference text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES auth.users(id);

DROP POLICY IF EXISTS "insert_own_withdrawals" ON public.withdrawals;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawals FROM authenticated;
DROP POLICY IF EXISTS "admin_select_withdrawals" ON public.withdrawals;
CREATE POLICY "admin_select_withdrawals" ON public.withdrawals FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.claim_task(p_task_id uuid, p_proof_text text DEFAULT NULL)
RETURNS public.task_completions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_completion public.task_completions%ROWTYPE;
  v_daily_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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

  IF v_task.proof_required AND length(btrim(COALESCE(p_proof_text, ''))) = 0 THEN
    RAISE EXCEPTION 'Proof is required for this task';
  END IF;
  IF length(COALESCE(p_proof_text, '')) > 2000 THEN
    RAISE EXCEPTION 'Proof must be 2000 characters or fewer';
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
        review_note = NULL,
        reviewed_at = NULL,
        reviewed_by = NULL,
        completed_at = now()
    WHERE id = v_completion.id
    RETURNING * INTO v_completion;

    RETURN v_completion;
  END IF;

  INSERT INTO public.task_completions (user_id, task_id, status, proof_text)
  VALUES (auth.uid(), p_task_id, 'pending', NULLIF(btrim(p_proof_text), ''))
  RETURNING * INTO v_completion;

  RETURN v_completion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_task(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_task(uuid, text) FROM PUBLIC, anon;

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
  v_pending numeric(12,2);
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

  SELECT COALESCE(sum(amount), 0) INTO v_pending
  FROM public.withdrawals WHERE user_id = p_user_id AND status = 'pending';
  IF v_reward + v_referral < v_pending THEN
    RAISE EXCEPTION 'Adjustment would leave pending withdrawals unfunded';
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
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_review_task_completion(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_task_completion(uuid, text, text) FROM PUBLIC, anon;

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
  v_withdrawal public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_amount < 500 OR p_amount >= 10000000000 THEN
    RAISE EXCEPTION 'Withdrawal must be at least Naira 500';
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
  IF v_reward + v_referral - v_pending < p_amount THEN
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
    IF NOT FOUND OR v_reward + v_referral < v_withdrawal.amount THEN
      RAISE EXCEPTION 'Wallet no longer covers this withdrawal';
    END IF;

    v_reward_debit := least(v_reward, v_withdrawal.amount);
    v_referral_debit := v_withdrawal.amount - v_reward_debit;

    IF v_reward_debit > 0 THEN
      UPDATE public.balances SET reward_balance = reward_balance - v_reward_debit, updated_at = now()
      WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (
        user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
      ) VALUES (
        v_withdrawal.user_id, auth.uid(), 'reward', -v_reward_debit, v_reward,
        v_reward - v_reward_debit, 'Paid withdrawal ' || p_withdrawal_id::text
      );
    END IF;

    IF v_referral_debit > 0 THEN
      UPDATE public.balances SET referral_balance = referral_balance - v_referral_debit, updated_at = now()
      WHERE user_id = v_withdrawal.user_id;
      INSERT INTO public.wallet_ledger (
        user_id, actor_id, balance_type, amount, balance_before, balance_after, reason
      ) VALUES (
        v_withdrawal.user_id, auth.uid(), 'referral', -v_referral_debit, v_referral,
        v_referral - v_referral_debit, 'Paid withdrawal ' || p_withdrawal_id::text
      );
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
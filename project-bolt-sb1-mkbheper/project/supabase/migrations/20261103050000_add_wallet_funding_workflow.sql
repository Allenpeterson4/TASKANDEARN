CREATE TABLE IF NOT EXISTS public.funding_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT true,
  bank_name text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT 'Transfer the exact amount, then submit your proof of payment.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.funding_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.funding_settings TO authenticated;
GRANT INSERT, UPDATE ON public.funding_settings TO authenticated;
CREATE POLICY "members_read_funding_settings" ON public.funding_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_manage_funding_settings" ON public.funding_settings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
INSERT INTO public.funding_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.funding_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount < 10000000000),
  payment_method text NOT NULL CHECK (payment_method IN ('paystack', 'flutterwave', 'manual')),
  provider_reference text UNIQUE,
  proof_text text,
  proof_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.funding_deposits ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.funding_deposits TO authenticated;
CREATE POLICY "members_read_own_funding_deposits" ON public.funding_deposits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins_read_funding_deposits" ON public.funding_deposits FOR SELECT TO authenticated USING (public.is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('funding-proofs', 'funding-proofs', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
CREATE POLICY "member_upload_own_funding_proof" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'funding-proofs' AND (storage.foldername(name))[1] = auth.uid()::text
);
CREATE POLICY "admin_read_funding_proofs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'funding-proofs' AND public.is_admin());

CREATE OR REPLACE FUNCTION public.submit_funding_deposit(
  p_amount numeric,
  p_payment_method text,
  p_proof_text text DEFAULT NULL,
  p_proof_path text DEFAULT NULL
)
RETURNS public.funding_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deposit public.funding_deposits%ROWTYPE;
  v_enabled boolean;
  v_reference text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_payment_method NOT IN ('paystack', 'flutterwave', 'manual') THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;
  SELECT enabled INTO v_enabled FROM public.funding_settings WHERE singleton;
  IF NOT COALESCE(v_enabled, false) THEN RAISE EXCEPTION 'Wallet funding is currently disabled'; END IF;
  IF p_amount <= 0 OR p_amount >= 10000000000 THEN RAISE EXCEPTION 'Enter a valid funding amount'; END IF;
  IF p_payment_method = 'manual' AND length(btrim(COALESCE(p_proof_text, ''))) < 5 AND p_proof_path IS NULL THEN
    RAISE EXCEPTION 'Manual funding requires payment proof';
  END IF;
  IF length(COALESCE(p_proof_text, '')) > 4000 THEN RAISE EXCEPTION 'Payment proof is too long'; END IF;
  IF p_proof_path IS NOT NULL AND (p_proof_path NOT LIKE auth.uid()::text || '/%' OR length(p_proof_path) > 500) THEN
    RAISE EXCEPTION 'Invalid proof upload path';
  END IF;
  v_reference := upper(p_payment_method) || '_FUND_' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.funding_deposits (user_id, amount, payment_method, provider_reference, proof_text, proof_path)
  VALUES (auth.uid(), p_amount, p_payment_method, v_reference, NULLIF(btrim(p_proof_text), ''), p_proof_path)
  RETURNING * INTO v_deposit;
  RETURN v_deposit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_funding_deposit(numeric, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_funding_deposit(numeric, text, text, text) FROM PUBLIC, anon;

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
    SELECT reward_balance INTO v_balance FROM public.balances WHERE user_id = v_deposit.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'User wallet not found'; END IF;
    UPDATE public.balances SET reward_balance = reward_balance + v_deposit.amount, total_earned = total_earned + v_deposit.amount, updated_at = now() WHERE user_id = v_deposit.user_id;
    INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
    VALUES (v_deposit.user_id, auth.uid(), 'reward', v_deposit.amount, v_balance, v_balance + v_deposit.amount, 'Confirmed wallet funding deposit ' || v_deposit.id::text);
    UPDATE public.funding_deposits SET status = 'confirmed', review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_deposit.id;
  ELSE
    UPDATE public.funding_deposits SET status = 'rejected', review_note = NULLIF(btrim(p_review_note), ''), reviewed_at = now(), reviewed_by = auth.uid() WHERE id = v_deposit.id;
  END IF;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE id = p_deposit_id;
  RETURN v_deposit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_review_funding_deposit(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_review_funding_deposit(uuid, text, text) FROM PUBLIC, anon;

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
  SELECT reward_balance INTO v_balance FROM public.balances WHERE user_id = v_deposit.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User wallet not found'; END IF;
  UPDATE public.balances SET reward_balance = reward_balance + v_deposit.amount, total_earned = total_earned + v_deposit.amount, updated_at = now() WHERE user_id = v_deposit.user_id;
  INSERT INTO public.wallet_ledger (user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
  VALUES (v_deposit.user_id, NULL, 'reward', v_deposit.amount, v_balance, v_balance + v_deposit.amount, 'Confirmed gateway funding deposit ' || v_deposit.id::text);
  UPDATE public.funding_deposits SET status = 'confirmed', reviewed_at = now() WHERE id = v_deposit.id;
  SELECT * INTO v_deposit FROM public.funding_deposits WHERE id = v_deposit.id;
  RETURN v_deposit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_gateway_funding(text) TO service_role;
REVOKE ALL ON FUNCTION public.complete_gateway_funding(text) FROM PUBLIC, anon, authenticated;

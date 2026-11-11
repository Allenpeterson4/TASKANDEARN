DROP POLICY IF EXISTS admin_delete_task_proofs ON storage.objects;
CREATE POLICY admin_delete_task_proofs ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'task-proofs' AND public.is_admin());

DROP POLICY IF EXISTS admin_delete_funding_proofs ON storage.objects;
CREATE POLICY admin_delete_funding_proofs ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'funding-proofs' AND public.is_admin());

CREATE OR REPLACE FUNCTION public.admin_preview_historical_cleanup(p_before date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_proof_bytes bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_before IS NULL OR p_before >= current_date THEN RAISE EXCEPTION 'Choose a past cutoff date'; END IF;

  SELECT COALESCE(sum(
    CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint ELSE 0 END
  ), 0) INTO v_proof_bytes
  FROM storage.objects o
  WHERE (o.bucket_id = 'task-proofs' AND EXISTS (
      SELECT 1 FROM public.task_completions c
      WHERE c.proof_path = o.name AND c.status IN ('approved', 'rejected') AND c.completed_at < p_before::timestamptz
    ))
    OR (o.bucket_id = 'funding-proofs' AND EXISTS (
      SELECT 1 FROM public.funding_deposits d
      WHERE d.proof_path = o.name AND d.status IN ('confirmed', 'rejected', 'expired') AND d.created_at < p_before::timestamptz
    ));

  RETURN jsonb_build_object(
    'hustles', (SELECT count(*) FROM public.task_completions WHERE status IN ('approved', 'rejected') AND completed_at < p_before::timestamptz),
    'withdrawals', (SELECT count(*) FROM public.withdrawals WHERE status IN ('paid', 'rejected') AND requested_at < p_before::timestamptz),
    'transactions',
      (SELECT count(*) FROM public.wallet_ledger WHERE created_at < p_before::timestamptz)
      + (SELECT count(*) FROM public.funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < p_before::timestamptz),
    'task_proofs', (SELECT count(*) FROM public.task_completions WHERE status IN ('approved', 'rejected') AND completed_at < p_before::timestamptz AND proof_path IS NOT NULL),
    'funding_proofs', (SELECT count(*) FROM public.funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < p_before::timestamptz AND proof_path IS NOT NULL),
    'proof_bytes', v_proof_bytes
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_preview_historical_cleanup(date) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_preview_historical_cleanup(date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_purge_historical_records(
  p_before date,
  p_hustles boolean,
  p_withdrawals boolean,
  p_transactions boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hustles integer := 0;
  v_withdrawals integer := 0;
  v_ledger integer := 0;
  v_funding integer := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_before IS NULL OR p_before >= current_date THEN RAISE EXCEPTION 'Choose a past cutoff date'; END IF;
  IF NOT COALESCE(p_hustles, false) AND NOT COALESCE(p_withdrawals, false) AND NOT COALESCE(p_transactions, false) THEN
    RAISE EXCEPTION 'Select at least one data category';
  END IF;

  IF p_hustles THEN
    DELETE FROM public.task_completions WHERE status IN ('approved', 'rejected') AND completed_at < p_before::timestamptz;
    GET DIAGNOSTICS v_hustles = ROW_COUNT;
  END IF;
  IF p_withdrawals THEN
    DELETE FROM public.withdrawals WHERE status IN ('paid', 'rejected') AND requested_at < p_before::timestamptz;
    GET DIAGNOSTICS v_withdrawals = ROW_COUNT;
  END IF;
  IF p_transactions THEN
    DELETE FROM public.wallet_ledger WHERE created_at < p_before::timestamptz;
    GET DIAGNOSTICS v_ledger = ROW_COUNT;
    DELETE FROM public.funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < p_before::timestamptz;
    GET DIAGNOSTICS v_funding = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_activity_log (actor_id, action, details)
  VALUES (auth.uid(), 'historical_data_cleanup', jsonb_build_object(
    'cutoff_date', p_before,
    'hustles_deleted', v_hustles,
    'withdrawals_deleted', v_withdrawals,
    'wallet_ledger_deleted', v_ledger,
    'funding_deposits_deleted', v_funding
  ));

  RETURN jsonb_build_object(
    'hustles', v_hustles,
    'withdrawals', v_withdrawals,
    'wallet_ledger', v_ledger,
    'funding_deposits', v_funding
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_purge_historical_records(date, boolean, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_purge_historical_records(date, boolean, boolean, boolean) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
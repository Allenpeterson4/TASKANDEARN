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
    'users_online', (SELECT count(DISTINCT user_id) FROM public.user_activity_daily WHERE last_heartbeat_at > now() - interval '5 minutes'),
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
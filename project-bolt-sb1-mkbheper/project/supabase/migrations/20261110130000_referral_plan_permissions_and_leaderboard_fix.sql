CREATE OR REPLACE FUNCTION public.user_feature_enabled(p_user_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan_code text;
  v_free_enabled boolean;
  v_premium_enabled boolean;
  v_settings jsonb;
BEGIN
  IF public.is_admin() THEN RETURN true; END IF;

  SELECT p.plan_code INTO v_plan_code
  FROM public.user_subscriptions s
  JOIN public.subscription_plans p USING (plan_code)
  WHERE s.user_id = p_user_id AND s.status = 'active' AND p.price > 0
    AND s.starts_at <= now() AND (s.ends_at IS NULL OR s.ends_at > now())
  ORDER BY s.starts_at DESC
  LIMIT 1;

  SELECT free_enabled, premium_enabled, settings
  INTO v_free_enabled, v_premium_enabled, v_settings
  FROM public.feature_permissions
  WHERE feature_key = p_feature_key;
  IF NOT FOUND THEN RETURN true; END IF;

  IF p_feature_key = 'custom-referral-code' THEN
    IF v_plan_code IS NULL OR NOT COALESCE(v_premium_enabled, false) THEN RETURN false; END IF;
    IF v_settings ? 'allowed_plan_codes' THEN
      RETURN jsonb_typeof(v_settings->'allowed_plan_codes') = 'array'
        AND (v_settings->'allowed_plan_codes' ? v_plan_code);
    END IF;
    RETURN true;
  END IF;

  RETURN COALESCE(CASE WHEN v_plan_code IS NOT NULL THEN v_premium_enabled ELSE v_free_enabled END, true);
END;
$$;
REVOKE ALL ON FUNCTION public.user_feature_enabled(uuid, text) FROM PUBLIC, anon, authenticated;

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
    SELECT row_number() OVER (ORDER BY scores.metric DESC, scores.user_id)::integer AS rank, scores.*
    FROM scores
    WHERE scores.metric > 0
  )
  SELECT ranked.rank,
    CASE WHEN public.is_admin() OR ranked.leaderboard_opt_in THEN ranked.user_id ELSE NULL::uuid END,
    CASE WHEN ranked.leaderboard_opt_in THEN COALESCE(NULLIF(ranked.full_name, ''), ranked.username)
      ELSE 'Hustler ' || substr(ranked.user_id::text, 1, 6) END,
    CASE WHEN ranked.leaderboard_opt_in THEN ranked.avatar_url ELSE NULL END,
    ranked.metric
  FROM ranked
  WHERE ranked.rank <= 20
  ORDER BY ranked.rank;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_leaderboard(text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
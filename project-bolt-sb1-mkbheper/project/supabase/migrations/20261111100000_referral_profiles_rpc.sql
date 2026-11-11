CREATE OR REPLACE FUNCTION public.get_my_referral_profiles()
RETURNS TABLE (
  referred_id uuid,
  full_name text,
  username text,
  avatar_url text,
  tier text,
  joined_at timestamptz,
  referral_created_at timestamptz,
  bonus_paid boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.tier, p.joined_at, r.created_at, r.bonus_paid
  FROM public.referrals r
  JOIN public.profiles p ON p.user_id = r.referred_id
  WHERE r.referrer_id = auth.uid()
  ORDER BY r.created_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.get_my_referral_profiles() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_referral_profiles() FROM PUBLIC, anon;
DO $$
DECLARE
  v_user record;
  v_referral_code text;
BEGIN
  FOR v_user IN SELECT id, email, raw_user_meta_data FROM auth.users LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user.id) THEN
      LOOP
        v_referral_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = v_referral_code);
      END LOOP;
      INSERT INTO public.profiles (user_id, username, full_name, phone, tier, referral_code)
      VALUES (
        v_user.id,
        COALESCE(NULLIF(split_part(v_user.email, '@', 1), ''), 'member'),
        COALESCE(v_user.raw_user_meta_data ->> 'full_name', ''),
        NULLIF(v_user.raw_user_meta_data ->> 'phone', ''),
        'Bronze',
        v_referral_code
      );
    END IF;
    INSERT INTO public.balances (user_id, reward_balance, referral_balance, total_earned)
    VALUES (v_user.id, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END;
$$;

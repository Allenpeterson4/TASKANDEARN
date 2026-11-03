DO $$
DECLARE
  v_user_count integer;
  v_user_id uuid;
BEGIN
  SELECT count(*)
  INTO v_user_count
  FROM auth.users;

  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one registered user, found %; refusing automatic admin promotion', v_user_count;
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  LIMIT 1;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', 'admin', 'mfa_required', false),
    updated_at = now()
  WHERE id = v_user_id;
END;
$$;

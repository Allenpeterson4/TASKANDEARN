CREATE OR REPLACE FUNCTION public.admin_start_support_conversation(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'User was not found';
  END IF;

  SELECT id INTO v_conversation_id
  FROM public.support_conversations
  WHERE user_id = p_user_id AND status = 'open';

  IF v_conversation_id IS NULL THEN
    INSERT INTO public.support_conversations (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) WHERE status = 'open' DO UPDATE
      SET updated_at = now()
    RETURNING id INTO v_conversation_id;
  END IF;

  INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
  VALUES (auth.uid(), p_user_id, 'support_conversation_opened', jsonb_build_object('conversation_id', v_conversation_id));

  RETURN v_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_start_support_conversation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_start_support_conversation(uuid) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
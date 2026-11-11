ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT 'Support request';

DROP INDEX IF EXISTS public.support_one_open_conversation_per_user;
CREATE INDEX IF NOT EXISTS support_conversations_user_status_updated_idx
  ON public.support_conversations (user_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS support_one_open_live_chat_per_user
  ON public.support_conversations (user_id)
  WHERE status = 'open' AND subject = 'Live chat';

CREATE OR REPLACE FUNCTION public.create_support_conversation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;

  SELECT id INTO v_conversation_id FROM public.support_conversations
  WHERE user_id = auth.uid() AND status = 'open' AND subject = 'Live chat'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_conversation_id IS NOT NULL THEN RETURN v_conversation_id; END IF;

  INSERT INTO public.support_conversations (user_id, subject)
  VALUES (auth.uid(), 'Live chat')
  ON CONFLICT (user_id) WHERE status = 'open' AND subject = 'Live chat'
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conversation_id;
  RETURN v_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_support_conversation() TO authenticated;
REVOKE ALL ON FUNCTION public.create_support_conversation() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.submit_support_ticket(p_subject text, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;
  IF length(btrim(COALESCE(p_subject, ''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Subject must contain 1 to 160 characters';
  END IF;
  IF length(btrim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Message must contain 1 to 4000 characters';
  END IF;

  INSERT INTO public.support_conversations (user_id, subject)
  VALUES (auth.uid(), btrim(p_subject))
  RETURNING id INTO v_conversation_id;
  INSERT INTO public.support_messages (conversation_id, author_id, body)
  VALUES (v_conversation_id, auth.uid(), btrim(p_body));
  RETURN v_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_support_ticket(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_support_ticket(text, text) FROM PUBLIC, anon;

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
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'User was not found'; END IF;

  SELECT id INTO v_conversation_id FROM public.support_conversations
  WHERE user_id = p_user_id AND status = 'open'
  ORDER BY updated_at DESC LIMIT 1;
  IF v_conversation_id IS NULL THEN
    INSERT INTO public.support_conversations (user_id, subject)
    VALUES (p_user_id, 'Admin support');
    SELECT id INTO v_conversation_id FROM public.support_conversations
    WHERE user_id = p_user_id AND status = 'open'
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.admin_activity_log (actor_id, subject_user_id, action, details)
  VALUES (auth.uid(), p_user_id, 'support_conversation_opened', jsonb_build_object('conversation_id', v_conversation_id));
  RETURN v_conversation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_start_support_conversation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_start_support_conversation(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_set_support_ticket_status(p_conversation_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'Invalid ticket status'; END IF;
  UPDATE public.support_conversations
  SET status = p_status, updated_at = now()
  WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Support ticket was not found'; END IF;

  INSERT INTO public.admin_activity_log (actor_id, action, details)
  VALUES (auth.uid(), 'support_ticket_status_changed', jsonb_build_object('conversation_id', p_conversation_id, 'status', p_status));
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_support_ticket_status(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_set_support_ticket_status(uuid, text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
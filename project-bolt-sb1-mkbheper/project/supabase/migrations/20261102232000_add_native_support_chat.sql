CREATE TABLE IF NOT EXISTS public.support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS support_one_open_conversation_per_user
  ON public.support_conversations (user_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS support_conversations_updated_idx
  ON public.support_conversations (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_conversation_idx
  ON public.support_messages (conversation_id, created_at);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.support_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.support_conversations, public.support_messages TO authenticated;

CREATE POLICY "members_read_own_support_conversations" ON public.support_conversations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins_read_support_conversations" ON public.support_conversations FOR SELECT
  TO authenticated USING (public.is_admin());
CREATE POLICY "members_read_own_support_messages" ON public.support_messages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.support_conversations AS conversation
      WHERE conversation.id = conversation_id AND conversation.user_id = auth.uid()
    )
  );
CREATE POLICY "admins_read_support_messages" ON public.support_messages FOR SELECT
  TO authenticated USING (public.is_admin());

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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active'
  ) THEN RAISE EXCEPTION 'This account is not active'; END IF;

  SELECT id INTO v_conversation_id FROM public.support_conversations
  WHERE user_id = auth.uid() AND status = 'open';
  IF v_conversation_id IS NOT NULL THEN RETURN v_conversation_id; END IF;

  INSERT INTO public.support_conversations (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) WHERE status = 'open' DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_conversation_id;
  RETURN v_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_support_conversation() TO authenticated;
REVOKE ALL ON FUNCTION public.create_support_conversation() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.send_support_message(p_conversation_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conversation public.support_conversations%ROWTYPE;
  v_message_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF length(btrim(COALESCE(p_body, ''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Message must contain 1 to 4000 characters';
  END IF;

  SELECT * INTO v_conversation FROM public.support_conversations
  WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_conversation.status <> 'open' THEN
    RAISE EXCEPTION 'Open conversation not found';
  END IF;
  IF NOT public.is_admin() THEN
    IF v_conversation.user_id <> auth.uid() THEN RAISE EXCEPTION 'Conversation access denied'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND account_status = 'active') THEN
      RAISE EXCEPTION 'This account is not active';
    END IF;
  END IF;

  INSERT INTO public.support_messages (conversation_id, author_id, body)
  VALUES (p_conversation_id, auth.uid(), btrim(p_body))
  RETURNING id INTO v_message_id;
  UPDATE public.support_conversations SET updated_at = now() WHERE id = p_conversation_id;
  RETURN v_message_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_support_message(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.send_support_message(uuid, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.admin_close_support_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required'; END IF;
  UPDATE public.support_conversations SET status = 'closed', updated_at = now()
  WHERE id = p_conversation_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Open support conversation not found'; END IF;
  INSERT INTO public.admin_activity_log (actor_id, action, details)
  VALUES (auth.uid(), 'support_conversation_closed', jsonb_build_object('conversation_id', p_conversation_id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_close_support_conversation(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_close_support_conversation(uuid) FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS public.auth_email_rate_limits (
  rate_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_email_rate_limits_updated_at_idx
  ON public.auth_email_rate_limits (updated_at);

ALTER TABLE public.auth_email_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_email_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auth_email_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_auth_email_rate_limit(
  p_email_hash text,
  p_ip_hash text,
  p_purpose text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email_count integer;
  v_ip_count integer;
BEGIN
  IF p_purpose IS NULL
    OR p_purpose NOT IN ('signup', 'password_reset')
    OR p_email_hash IS NULL
    OR p_ip_hash IS NULL
    OR p_email_hash !~ '^[0-9a-f]{64}$'
    OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid account email rate limit key';
  END IF;

  INSERT INTO public.auth_email_rate_limits AS existing (rate_key, window_started_at, request_count, updated_at)
  VALUES ('email:' || p_purpose || ':' || p_email_hash, now(), 1, now())
  ON CONFLICT (rate_key) DO UPDATE
    SET window_started_at = CASE
          WHEN existing.window_started_at <= now() - interval '1 hour' THEN now()
          ELSE existing.window_started_at
        END,
        request_count = CASE
          WHEN existing.window_started_at <= now() - interval '1 hour' THEN 1
          ELSE existing.request_count + 1
        END,
        updated_at = now()
  RETURNING request_count INTO v_email_count;

  INSERT INTO public.auth_email_rate_limits AS existing (rate_key, window_started_at, request_count, updated_at)
  VALUES ('ip:' || p_ip_hash, now(), 1, now())
  ON CONFLICT (rate_key) DO UPDATE
    SET window_started_at = CASE
          WHEN existing.window_started_at <= now() - interval '1 hour' THEN now()
          ELSE existing.window_started_at
        END,
        request_count = CASE
          WHEN existing.window_started_at <= now() - interval '1 hour' THEN 1
          ELSE existing.request_count + 1
        END,
        updated_at = now()
  RETURNING request_count INTO v_ip_count;

  DELETE FROM public.auth_email_rate_limits
  WHERE rate_key IN (
    SELECT rate_key FROM public.auth_email_rate_limits
    WHERE updated_at < now() - interval '2 days'
    LIMIT 100
  );

  RETURN v_email_count <= 3 AND v_ip_count <= 20;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_auth_email_rate_limit(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_email_rate_limit(text, text, text) TO service_role;

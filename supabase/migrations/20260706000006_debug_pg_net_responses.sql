-- Temporary diagnostic RPC to see what pg_net actually got back when
-- notify_vendor_application() called send-vendor-ack-email, since no email
-- arrived for the test applications. Read-only, safe to drop afterward.

CREATE OR REPLACE FUNCTION public.debug_net_responses()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'status_code', status_code,
    'content', content,
    'error_msg', error_msg,
    'created', created
  ) ORDER BY id DESC)
  FROM (
    SELECT * FROM net._http_response ORDER BY id DESC LIMIT 10
  ) recent;
$$;

REVOKE ALL ON FUNCTION public.debug_net_responses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_net_responses() TO anon, authenticated;

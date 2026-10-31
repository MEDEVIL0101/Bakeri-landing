-- Daily limits on the features that call Claude (security audit
-- 2026-10-31): anyone can create an account, so without a cap one account
-- could run up Bakeri's Anthropic bill. Rolling 24 hours, per vendor.
--   claude-api-proxy      'ai'           (recipe scans)       10 / day
--   import-external-form  'form_import'  (Google/JotForm)      5 / day
-- Written and read only by those edge functions (service role).

CREATE TABLE IF NOT EXISTS public.ai_usage (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    feature    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_user_feature_time ON public.ai_usage (user_id, feature, created_at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

-- Takes one use if the vendor is under p_limit for the last 24 hours.
-- Returns the new row id, or NULL when the limit is reached. Serialised per
-- vendor so parallel requests can't slip past the cap.
CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_user_id UUID, p_feature TEXT, p_limit INT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_feature));
    IF (SELECT count(*) FROM ai_usage
        WHERE user_id = p_user_id AND feature = p_feature
          AND created_at > now() - interval '24 hours') >= p_limit THEN
        RETURN NULL;
    END IF;
    INSERT INTO ai_usage (user_id, feature) VALUES (p_user_id, p_feature) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Gives a use back when the Claude call failed.
CREATE OR REPLACE FUNCTION public.refund_ai_quota(p_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ DELETE FROM public.ai_usage WHERE id = p_id; $$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ai_quota(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_ai_quota(BIGINT) TO service_role;

SELECT cron.schedule(
    'ai-usage-prune',
    '41 4 * * *',
    $$ DELETE FROM public.ai_usage WHERE created_at < now() - interval '7 days'; $$
);

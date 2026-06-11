-- Registration event logging — captures IP, country, user-agent, and provider
-- for every new account created.  Used to detect bulk/bot registrations.
--
-- Two-layer capture:
--   1. Postgres trigger on auth.users INSERT — fires synchronously, extracts
--      IP from the PostgREST request-headers context where available.
--   2. auth-signup-hook edge function (HTTP hook) — fires asynchronously,
--      reads Cloudflare headers (cf-connecting-ip, cf-ipcountry) which are
--      authoritative for client IP.  Upserts into this table, enriching the
--      row the trigger already inserted.
--
-- Zero RLS policies: no client can read or write this table.

CREATE TABLE IF NOT EXISTS public.registration_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL UNIQUE,
  email         TEXT,
  ip_address    TEXT,
  country_code  TEXT,
  user_agent    TEXT,
  provider      TEXT,       -- 'email', 'google', 'apple', etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.registration_events ENABLE ROW LEVEL SECURITY;

-- ─── Trigger ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_registration_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
  v_ip      text;
  v_ua      text;
BEGIN
  -- request.headers is set by PostgREST for every HTTP request.
  -- In the auth context this may be absent; the exception handler swallows that.
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
    v_ip := NULLIF(TRIM(COALESCE(
      v_headers->>'cf-connecting-ip',
      v_headers->>'x-real-ip',
      SPLIT_PART(v_headers->>'x-forwarded-for', ',', 1)
    )), '');
    v_ua := v_headers->>'user-agent';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
    v_ua := NULL;
  END;

  INSERT INTO public.registration_events (
    user_id, email, ip_address, user_agent, provider
  ) VALUES (
    NEW.id,
    NEW.email,
    v_ip,
    v_ua,
    NEW.raw_app_meta_data->>'provider'
  )
  ON CONFLICT (user_id) DO UPDATE
    SET ip_address   = COALESCE(EXCLUDED.ip_address,   registration_events.ip_address),
        user_agent   = COALESCE(EXCLUDED.user_agent,   registration_events.user_agent),
        provider     = COALESCE(EXCLUDED.provider,     registration_events.provider);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_registration ON auth.users;
CREATE TRIGGER trg_log_registration
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION log_registration_trigger();

-- ─── Useful admin queries ─────────────────────────────────────────────────────
-- Burst detection: IPs that registered 3+ accounts in the past 24 hours.
-- Run from Supabase SQL editor (service role):
--
--   SELECT ip_address, country_code, COUNT(*) AS accounts,
--          MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
--   FROM registration_events
--   WHERE created_at > NOW() - INTERVAL '24 hours'
--     AND ip_address IS NOT NULL
--   GROUP BY ip_address, country_code
--   HAVING COUNT(*) >= 3
--   ORDER BY accounts DESC;

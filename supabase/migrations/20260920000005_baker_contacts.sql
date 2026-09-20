-- Unified contacts list — one table for storefront-captured signups AND
-- order-derived customers (deliberately not two parallel lists; see the
-- plan doc's Phase 3 section). Feeds: capture-storefront-email (popup/
-- inline/header capture blocks + lead-magnet delivery), the "add this
-- buyer to your customer list?" prompt on new orders, the campaign sender,
-- and a manual-order customer picker for autofill.
--
-- Consent/compliance kept deliberately simple: a contact is either
-- subscribed or not (unsubscribed_at IS NULL), regardless of source. The
-- actual compliance backstop is that every promotional send carries a
-- mandatory one-click unsubscribe link built from unsubscribe_token (see
-- the companion `unsubscribe` edge function) — not a separate consent flag
-- per source.

CREATE TABLE IF NOT EXISTS public.baker_contacts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    email              TEXT NOT NULL,
    name               TEXT,
    phone              TEXT,
    source             TEXT NOT NULL,
    first_order_id     UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    unsubscribe_token  UUID NOT NULL DEFAULT gen_random_uuid(),
    unsubscribed_at    TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT baker_contacts_source_check
        CHECK (source IN ('order', 'popup', 'inline', 'header', 'lead_magnet', 'manual')),
    UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS baker_contacts_user_idx ON public.baker_contacts (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS baker_contacts_unsubscribe_token_idx ON public.baker_contacts (unsubscribe_token);

ALTER TABLE public.baker_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "baker_manage_own_contacts"
ON public.baker_contacts FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- No anon/authenticated INSERT policy — deliberately. The established
-- convention in this codebase (see 20260706000011_vendor_applications_via_function.sql,
-- which REVOKED a direct anon-INSERT policy in favor of routing exclusively
-- through an edge function) is that public writes with real validation
-- needs go through a SECURITY DEFINER edge function, not raw RLS, since
-- checks like email-format validation and rate limiting can't be expressed
-- in a CHECK constraint alone. capture-storefront-email (service-role
-- client, bypasses RLS) is the only public write path onto this table.
COMMENT ON TABLE public.baker_contacts IS
    'Unified list of a baker''s known contacts — storefront signups (popup/inline/header/lead_magnet) and order-derived customers (order), plus manually-added (manual). Public writes only via capture-storefront-email edge function, never direct RLS.';

-- Rate-limit telemetry only — never exposed to anon/authenticated (RLS
-- enabled, zero policies; service_role bypasses RLS as usual). Deliberately
-- separate from baker_contacts itself so per-visitor IP data isn't
-- permanently attached to real contact/customer records — this table is
-- pure abuse-prevention bookkeeping, prunable at any time with no user-
-- facing consequence.
CREATE TABLE IF NOT EXISTS public.email_capture_attempts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_capture_attempts_ip_idx ON public.email_capture_attempts (ip_address, created_at DESC);
ALTER TABLE public.email_capture_attempts ENABLE ROW LEVEL SECURITY;

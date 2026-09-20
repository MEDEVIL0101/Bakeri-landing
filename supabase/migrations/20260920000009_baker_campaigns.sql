-- Campaign sending to a baker's baker_contacts list. baker_campaigns holds
-- the composed email; baker_campaign_sends is a per-recipient log — both
-- prevents double-sends on retry and gives the baker visibility into what
-- actually went out. Optional cta_listing_id lets a campaign's button
-- point at an existing product, same URL-or-product target concept as
-- baker_links (see 20260920000003_baker_links_rich_cards.sql).

CREATE TABLE IF NOT EXISTS public.baker_campaigns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject          TEXT NOT NULL,
    body_text        TEXT NOT NULL DEFAULT '',
    image_url        TEXT,
    cta_label        TEXT,
    cta_url          TEXT,
    cta_listing_id   UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
    status           TEXT NOT NULL DEFAULT 'draft',
    recipient_count  INTEGER NOT NULL DEFAULT 0,
    sent_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT baker_campaigns_status_check CHECK (status IN ('draft', 'sending', 'sent', 'failed'))
);
CREATE INDEX IF NOT EXISTS baker_campaigns_user_idx ON public.baker_campaigns (user_id, created_at DESC);
ALTER TABLE public.baker_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "baker_manage_own_campaigns"
ON public.baker_campaigns FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.baker_campaign_sends (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id   UUID NOT NULL REFERENCES public.baker_campaigns(id) ON DELETE CASCADE,
    contact_id    UUID REFERENCES public.baker_contacts(id) ON DELETE SET NULL,
    email         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    sent_at       TIMESTAMPTZ,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT baker_campaign_sends_status_check CHECK (status IN ('pending', 'sent', 'failed'))
);
CREATE INDEX IF NOT EXISTS baker_campaign_sends_campaign_idx ON public.baker_campaign_sends (campaign_id);
-- Baker can read (not write — only send-baker-campaign's service-role
-- client writes these) her own campaigns' send logs, via a join back to
-- baker_campaigns (this table has no user_id column of its own).
ALTER TABLE public.baker_campaign_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "baker_read_own_campaign_sends"
ON public.baker_campaign_sends FOR SELECT
USING (
  campaign_id IN (SELECT id FROM public.baker_campaigns WHERE user_id = auth.uid())
);

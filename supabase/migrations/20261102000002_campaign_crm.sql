-- Customer outreach / CRM for email campaigns (Harvey 2026-11-02).
--   * Customers get tags (vendor-made groups) and private notes.
--   * A campaign remembers who it's for (audience): everyone, a group worked
--     out from orders, some tags, or hand-picked customers. The web app turns
--     the audience into the list of contact ids; send-baker-campaign only
--     ever sends to the vendor's own subscribed contacts in that list.
--   * Each email sent gets a tracking token: a 1×1 image records the open,
--     and the button goes through campaign-track to record the click. Both
--     are written only by that function (service role) via
--     record_campaign_event().

ALTER TABLE public.baker_contacts
    ADD COLUMN IF NOT EXISTS tags  TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS baker_contacts_tags_idx ON public.baker_contacts USING GIN (tags);

-- { "type": "all" | "ordered" | "never_ordered" | "recent" | "lapsed" | "tags" | "picked",
--   "label": "Customers who've ordered", "tags": [...], "contact_ids": [...] }
ALTER TABLE public.baker_campaigns
    ADD COLUMN IF NOT EXISTS audience JSONB;

ALTER TABLE public.baker_campaign_sends
    ADD COLUMN IF NOT EXISTS track_token UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS opened_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS open_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS clicked_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS baker_campaign_sends_track_token_idx ON public.baker_campaign_sends (track_token);
CREATE INDEX IF NOT EXISTS baker_campaign_sends_contact_idx ON public.baker_campaign_sends (contact_id);

-- One open or click for the email with this token. A click also counts as
-- an open (images are often blocked). Returns the send's campaign id, or
-- NULL for an unknown token.
CREATE OR REPLACE FUNCTION public.record_campaign_event(p_token UUID, p_kind TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_campaign UUID;
BEGIN
    IF p_kind = 'click' THEN
        UPDATE baker_campaign_sends
           SET click_count = click_count + 1,
               clicked_at  = COALESCE(clicked_at, now()),
               opened_at   = COALESCE(opened_at, now()),
               open_count  = GREATEST(open_count, 1)
         WHERE track_token = p_token
        RETURNING campaign_id INTO v_campaign;
    ELSE
        UPDATE baker_campaign_sends
           SET open_count = open_count + 1,
               opened_at  = COALESCE(opened_at, now())
         WHERE track_token = p_token
        RETURNING campaign_id INTO v_campaign;
    END IF;
    RETURN v_campaign;
END;
$$;

REVOKE ALL ON FUNCTION public.record_campaign_event(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_campaign_event(UUID, TEXT) TO service_role;

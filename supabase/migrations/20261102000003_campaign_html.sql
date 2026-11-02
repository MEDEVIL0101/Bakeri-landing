-- Custom-HTML campaign emails (Harvey 2026-11-02). When body_html is set the
-- email is the vendor's own HTML (cleaned by send-baker-campaign, with our
-- unsubscribe footer and open pixel added); body_text then holds a plain-text
-- version for lists and the iPhone app. links = the email's http(s) links,
-- saved at send time — campaign-track redirects a click only to one of these.
ALTER TABLE public.baker_campaigns
    ADD COLUMN IF NOT EXISTS body_html TEXT,
    ADD COLUMN IF NOT EXISTS links     JSONB;

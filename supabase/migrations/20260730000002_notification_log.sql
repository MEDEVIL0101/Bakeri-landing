-- Every guest-order email send (received/confirmed/quote/ready/cancelled/
-- declined-refund) previously failed silently: the Resend call's response
-- was only ever passed to console.error, and the DB trigger that invokes
-- these functions (call_guest_order_webhook, via net.http_post) never reads
-- back the HTTP response at all. A webhook-secret mismatch or a Resend
-- failure (bad recipient address, revoked key, etc.) was therefore
-- completely invisible — nobody, baker or Bakeri, could tell an email never
-- went out. This table gives every send attempt a durable, queryable record.

CREATE TABLE public.notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_log_order_id ON public.notification_log(order_id);
CREATE INDEX idx_notification_log_status_created_at ON public.notification_log(status, created_at);

-- Service-role only (edge functions write via SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS entirely) — no policy is defined for anon/authenticated,
-- so RLS alone locks this down to nobody from the client side. This is a
-- debugging/ops table, not customer- or baker-facing data.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.notification_log IS 'Durable record of every guest-order email send attempt (success or failure), so a Resend/webhook-secret failure is visible instead of only ever reaching console.error in an edge function log nobody watches.';

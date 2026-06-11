-- Security hardening — remaining findings (5, 11, 14, 15, 20, 21).

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 5: beta_reminders_sent — RLS enabled, no policies (intentional).
-- ─────────────────────────────────────────────────────────────────────────────
-- This table is written exclusively by the service role (admin edge function or
-- direct Supabase dashboard insert).  No authenticated client ever reads or
-- writes it, so zero policies is the correct, most-restrictive state: any
-- client attempting to touch the table gets a permission-denied error.
-- No schema change needed — this comment documents the intentional design.

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 11: Baker UPDATE policy is too broad — guard payment / ownership
--             columns so an authenticated baker cannot alter them.
-- ─────────────────────────────────────────────────────────────────────────────
-- The existing "marketplace_baker_update_quote" policy (USING user_id =
-- auth.uid()) correctly scopes which rows a baker may update, but allows any
-- column to change.  A BEFORE UPDATE trigger running as SECURITY INVOKER blocks
-- changes to sensitive fields when the session role is 'authenticated'.
-- SECURITY DEFINER RPCs (confirm_pickup) and the service role bypass this
-- because they execute as 'postgres' / 'service_role'.

CREATE OR REPLACE FUNCTION orders_guard_sensitive_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Allow postgres / service_role to make any change (RPCs, edge functions).
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status       IS DISTINCT FROM OLD.payment_status
     OR NEW.buyer_profile_id  IS DISTINCT FROM OLD.buyer_profile_id
     OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
     OR NEW.stripe_fee         IS DISTINCT FROM OLD.stripe_fee
     OR NEW.order_source       IS DISTINCT FROM OLD.order_source
  THEN
    RAISE EXCEPTION 'Clients cannot modify protected order fields (payment_status, buyer_profile_id, payment_intent_id, stripe_fee, order_source)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_guard_sensitive_columns ON public.orders;
CREATE TRIGGER trg_orders_guard_sensitive_columns
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION orders_guard_sensitive_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 14: No rate limiting on community content creation.
-- Limit: 20 threads per user per hour, 60 comments per user per hour.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "threads_insert" ON public.community_threads;
CREATE POLICY "threads_insert"
ON public.community_threads
FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND (
    SELECT COUNT(*)
    FROM public.community_threads
    WHERE author_id = auth.uid()
      AND created_at > NOW() - INTERVAL '1 hour'
  ) < 20
);

DROP POLICY IF EXISTS "comments_insert" ON public.community_comments;
CREATE POLICY "comments_insert"
ON public.community_comments
FOR INSERT
WITH CHECK (
  auth.uid() = author_id
  AND (
    SELECT COUNT(*)
    FROM public.community_comments
    WHERE author_id = auth.uid()
      AND created_at > NOW() - INTERVAL '1 hour'
  ) < 60
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 15: account_deletion_requests table was referenced in app code but
--             never created via a migration.  Create it now idempotently.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_for  TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Users may insert / upsert their own deletion request.
DROP POLICY IF EXISTS "deletion_requests_insert" ON public.account_deletion_requests;
CREATE POLICY "deletion_requests_insert"
ON public.account_deletion_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users may read their own deletion request (to check cancellation status).
DROP POLICY IF EXISTS "deletion_requests_select" ON public.account_deletion_requests;
CREATE POLICY "deletion_requests_select"
ON public.account_deletion_requests
FOR SELECT
USING (auth.uid() = user_id);

-- Users may update their own row (needed for upsert).
DROP POLICY IF EXISTS "deletion_requests_update" ON public.account_deletion_requests;
CREATE POLICY "deletion_requests_update"
ON public.account_deletion_requests
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Users may delete their own row to cancel the scheduled deletion.
DROP POLICY IF EXISTS "deletion_requests_delete" ON public.account_deletion_requests;
CREATE POLICY "deletion_requests_delete"
ON public.account_deletion_requests
FOR DELETE
USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 20: community_group_members SELECT is public (USING true).
-- This is intentional: guest browsing requires unauthenticated reads to render
-- group membership counts and the community feed.  Migration 20260520000003
-- tried restricting this to auth.uid() IS NOT NULL but that broke the guest
-- experience (20260520000006 reverted it).  Public read of group membership is
-- an accepted trade-off; write operations (INSERT/DELETE) remain auth-gated.
-- No schema change — this comment documents the intentional design decision.

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding 21: Order message content was exposed in push notification previews.
-- Replace the message body text with a generic string so lock-screen previews
-- don't reveal private conversation content between baker and buyer.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_fn_order_message_notify()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_order       orders%ROWTYPE;
  v_recipient   UUID;
  v_sender_name TEXT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_profile_id = v_order.user_id THEN
    v_recipient   := v_order.buyer_profile_id;
    v_sender_name := COALESCE(v_order.baker_display_name, 'Your baker');
  ELSE
    v_recipient   := v_order.user_id;
    v_sender_name := COALESCE(v_order.buyer_display_name, 'A customer');
  END IF;

  IF v_recipient IS NOT NULL THEN
    PERFORM send_marketplace_notification(
      v_recipient,
      '💬 New Message',
      'Message from ' || v_sender_name,
      jsonb_build_object('type', 'new_message', 'order_id', NEW.order_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

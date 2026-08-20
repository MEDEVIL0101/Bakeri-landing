-- Admin order action log + cancel RPC.
--
-- admin_order_actions: immutable audit trail of every admin mutation on an order.
-- admin_cancel_order:  atomically sets marketplace_status = 'admin_cancelled',
--                      records the reason, and marks refund_requested.
-- admin_suspend_baker: cancels all pending/confirmed orders for a baker,
--                      logs each action, then marks their profile suspended.

-- ── Audit table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_order_actions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         UUID        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    action_type      TEXT        NOT NULL CHECK (action_type IN ('cancelled', 'refund_requested', 'note')),
    reason           TEXT        NOT NULL,
    refund_requested BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service role only — no client access
ALTER TABLE public.admin_order_actions ENABLE ROW LEVEL SECURITY;

-- ── Cancel RPC ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_cancel_order(
    p_order_id         UUID,
    p_reason           TEXT,
    p_refund_requested BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Guard: only cancel orders that are still active
    IF NOT EXISTS (
        SELECT 1 FROM public.orders
        WHERE id = p_order_id
          AND COALESCE(marketplace_status, status) NOT IN ('admin_cancelled', 'completed', 'delivered')
    ) THEN
        RAISE EXCEPTION 'order_not_cancellable';
    END IF;

    UPDATE public.orders
    SET    marketplace_status = 'admin_cancelled',
           status             = CASE WHEN order_source = 'marketplace' THEN status ELSE 'cancelled' END
    WHERE  id = p_order_id;

    INSERT INTO public.admin_order_actions
        (order_id, action_type, reason, refund_requested)
    VALUES
        (p_order_id, 'cancelled', p_reason, p_refund_requested);
END;
$$;

REVOKE ALL  ON FUNCTION public.admin_cancel_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order TO service_role;

-- ── Suspend-baker RPC (cancels pending orders as side effect) ────────────────

CREATE OR REPLACE FUNCTION public.admin_suspend_baker(
    p_baker_id UUID,
    p_reason   TEXT DEFAULT 'Account suspended by admin'
)
RETURNS INT   -- number of orders cancelled
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id    UUID;
    v_cancelled   INT := 0;
BEGIN
    -- Cancel every pending / confirmed order for this baker
    FOR v_order_id IN
        SELECT id FROM public.orders
        WHERE  user_id = p_baker_id
          AND  deleted_at IS NULL
          AND  COALESCE(marketplace_status, status)
               IN ('pending', 'confirmed', 'accepted')
    LOOP
        UPDATE public.orders
        SET    marketplace_status = 'admin_cancelled',
               status             = CASE WHEN order_source = 'marketplace' THEN status ELSE 'cancelled' END
        WHERE  id = v_order_id;

        INSERT INTO public.admin_order_actions
            (order_id, action_type, reason, refund_requested)
        VALUES
            (v_order_id, 'cancelled', p_reason, true);

        v_cancelled := v_cancelled + 1;
    END LOOP;

    RETURN v_cancelled;
END;
$$;

REVOKE ALL  ON FUNCTION public.admin_suspend_baker FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suspend_baker TO service_role;

-- Pre-order batch system
-- Bakers create scheduled batches (e.g. "20 sourdough loaves, every Saturday");
-- buyers reserve slots and pay upfront; baker scans QR at pickup to confirm and
-- release funds to the weekly payout cycle.

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preorder_batches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    baker_user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    menu_item_id    UUID        REFERENCES menu_items(id) ON DELETE SET NULL,

    title           TEXT        NOT NULL,
    description     TEXT,
    unit            TEXT        NOT NULL DEFAULT 'unit',   -- "loaf", "dozen", "box"
    category        TEXT,
    image_url       TEXT,

    pickup_date     DATE        NOT NULL,
    order_cutoff    DATE        NOT NULL,

    total_slots     INT         NOT NULL CHECK (total_slots > 0),
    price_per_slot  NUMERIC(10,2) NOT NULL CHECK (price_per_slot > 0),

    frequency       TEXT        CHECK (frequency IN ('weekly','biweekly','monthly')),
    notes           TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preorder_reservations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            UUID        NOT NULL REFERENCES preorder_batches(id) ON DELETE CASCADE,
    buyer_profile_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    quantity            INT         NOT NULL DEFAULT 1 CHECK (quantity > 0),

    payment_intent_id   TEXT,
    payment_status      TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending','paid','refunded','failed')),
    amount_paid_cents   INT,

    qr_token            UUID        NOT NULL DEFAULT gen_random_uuid(),
    pickup_confirmed_at TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (batch_id, buyer_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_preorder_reservations_batch_id   ON preorder_reservations (batch_id);
CREATE INDEX IF NOT EXISTS idx_preorder_reservations_buyer      ON preorder_reservations (buyer_profile_id);
CREATE INDEX IF NOT EXISTS idx_preorder_batches_baker           ON preorder_batches (baker_user_id);
CREATE INDEX IF NOT EXISTS idx_preorder_batches_pickup          ON preorder_batches (pickup_date);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE preorder_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE preorder_reservations ENABLE ROW LEVEL SECURITY;

-- Batches: anyone can read active batches; only the baker can mutate their own
CREATE POLICY "preorder_batches: public read active"
    ON preorder_batches FOR SELECT
    USING (is_active = true);

CREATE POLICY "preorder_batches: baker insert own"
    ON preorder_batches FOR INSERT
    WITH CHECK (baker_user_id = auth.uid());

CREATE POLICY "preorder_batches: baker update own"
    ON preorder_batches FOR UPDATE
    USING (baker_user_id = auth.uid());

CREATE POLICY "preorder_batches: baker delete own"
    ON preorder_batches FOR DELETE
    USING (baker_user_id = auth.uid());

-- Baker can also read their own inactive batches (e.g. for management views)
CREATE POLICY "preorder_batches: baker read own"
    ON preorder_batches FOR SELECT
    USING (baker_user_id = auth.uid());

-- Reservations: buyers see their own; bakers see for their batches; buyers insert own
CREATE POLICY "preorder_reservations: buyer read own"
    ON preorder_reservations FOR SELECT
    USING (buyer_profile_id = auth.uid());

CREATE POLICY "preorder_reservations: baker read own batch"
    ON preorder_reservations FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM preorder_batches
        WHERE id = batch_id AND baker_user_id = auth.uid()
    ));

CREATE POLICY "preorder_reservations: buyer insert own"
    ON preorder_reservations FOR INSERT
    WITH CHECK (buyer_profile_id = auth.uid());

CREATE POLICY "preorder_reservations: buyer update own quantity"
    ON preorder_reservations FOR UPDATE
    USING (buyer_profile_id = auth.uid())
    WITH CHECK (buyer_profile_id = auth.uid() AND pickup_confirmed_at IS NULL);

CREATE POLICY "preorder_reservations: baker confirm pickup"
    ON preorder_reservations FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM preorder_batches
        WHERE id = batch_id AND baker_user_id = auth.uid()
    ));

-- ── Trigger: updated_at ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_preorder_batch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_preorder_batches_updated_at
    BEFORE UPDATE ON preorder_batches
    FOR EACH ROW EXECUTE FUNCTION set_preorder_batch_updated_at();

-- ── RPC: confirm pickup via buyer's QR token ──────────────────────────────────

CREATE OR REPLACE FUNCTION confirm_preorder_pickup(p_qr_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_res   preorder_reservations%ROWTYPE;
    v_batch preorder_batches%ROWTYPE;
BEGIN
    SELECT * INTO v_res
    FROM   preorder_reservations
    WHERE  qr_token = p_qr_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'QR code not recognised');
    END IF;

    IF v_res.pickup_confirmed_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pickup already confirmed');
    END IF;

    SELECT * INTO v_batch
    FROM   preorder_batches
    WHERE  id = v_res.batch_id AND baker_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorised for this batch');
    END IF;

    UPDATE preorder_reservations
    SET    pickup_confirmed_at = now()
    WHERE  id = v_res.id;

    RETURN jsonb_build_object(
        'success',          true,
        'reservation_id',   v_res.id,
        'buyer_profile_id', v_res.buyer_profile_id,
        'quantity',         v_res.quantity,
        'batch_title',      v_batch.title
    );
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_preorder_pickup TO authenticated;

-- ── View: batches with filled slot counts (for admin panel + baker dashboard) ─

CREATE OR REPLACE VIEW preorder_batches_with_stats AS
SELECT
    b.*,
    COALESCE(
        SUM(r.quantity) FILTER (WHERE r.payment_status IN ('paid', 'pending')),
        0
    )::INT AS filled_slots,
    COUNT(DISTINCT r.buyer_profile_id)
        FILTER (WHERE r.payment_status IN ('paid', 'pending'))::INT AS buyer_count
FROM preorder_batches b
LEFT JOIN preorder_reservations r ON r.batch_id = b.id
GROUP BY b.id;

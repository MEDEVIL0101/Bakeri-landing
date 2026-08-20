-- ============================================================
-- Marketplace Phase 1 Migration
-- Adds marketplace listing fields to menu_items and
-- marketplace order fields to orders.
-- Safe to run multiple times (all changes use IF NOT EXISTS /
-- DO $$ blocks with existence checks).
-- ============================================================

-- MARK: menu_items — marketplace listing fields

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS is_listed_in_marketplace  BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS listing_kind              TEXT        NOT NULL DEFAULT 'ready_now',
    ADD COLUMN IF NOT EXISTS lead_days                 INTEGER     NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS available_qty_today       INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS marketplace_price_from    NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Constrain listing_kind to valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'menu_items_listing_kind_check'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT menu_items_listing_kind_check
            CHECK (listing_kind IN ('ready_now', 'preorder', 'custom'));
    END IF;
END $$;

-- MARK: orders — marketplace order fields

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_source           TEXT    NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS marketplace_status     TEXT,
    ADD COLUMN IF NOT EXISTS buyer_profile_id       UUID    REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS buyer_display_name     TEXT    NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS scheduled_pickup_date  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_intent_id      TEXT,
    ADD COLUMN IF NOT EXISTS payment_status         TEXT;

-- Constrain order_source to valid values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_order_source_check'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_order_source_check
            CHECK (order_source IN ('manual', 'marketplace'));
    END IF;
END $$;

-- Constrain marketplace_status to valid values (nullable — NULL for manual orders)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_marketplace_status_check'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_marketplace_status_check
            CHECK (marketplace_status IS NULL OR marketplace_status IN ('pending', 'confirmed', 'declined'));
    END IF;
END $$;

-- Index: efficiently fetch pending marketplace orders for a baker
CREATE INDEX IF NOT EXISTS orders_marketplace_pending_idx
    ON orders (user_id, marketplace_status)
    WHERE marketplace_status = 'pending';

-- Index: fetch all marketplace orders for a buyer
CREATE INDEX IF NOT EXISTS orders_buyer_profile_idx
    ON orders (buyer_profile_id)
    WHERE buyer_profile_id IS NOT NULL;

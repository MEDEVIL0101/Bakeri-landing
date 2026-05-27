-- ============================================================
-- Marketplace Phase 2: Public read access for listed items
-- ============================================================

-- Allow any authenticated user to read menu items that are
-- actively listed in the marketplace.
-- (Unauthenticated public access is intentionally excluded —
-- browsing the marketplace requires sign-in.)

CREATE POLICY "marketplace_items_public_read"
ON menu_items FOR SELECT
USING (
    is_listed_in_marketplace = true
    AND is_active = true
);

-- Profiles are already public-readable (from 20260520000007),
-- but ensure the join fields used by the marketplace query
-- are accessible. No additional policy needed if profiles
-- already has a public SELECT policy.

# Pickup locations — plan & rollout

Branch `feature/pickup-locations`. Nothing here is applied or deployed until reviewed.

## What it is
A shop can have several pickup locations — home, a second town (Show Low / Mesa),
a farmers market ("buy ahead, collect at the stall"). One is **primary**.

- **One location → nothing changes.** Buyers never see a choice.
- **Two or more → buyers pick**: "Show Low · Mon Nov 24", "Gilbert Farmers Market · Sat Nov 22 · 8–12".

## Data (`supabase/migrations/20261111000001_pickup_locations.sql`)
- `pickup_locations` — name, address, city, province, postal code, note (shown to
  buyers, e.g. "look for the pink tent"), `is_primary` (one per shop), sort order.
- `profiles.pickup_*` mirror the primary location in both directions (triggers), so
  older app builds and every existing reader keep working untouched.
- Backfill: each shop's current pickup address becomes its primary location.
- `menu_items.pickup_location_ids` (NULL = primary only),
  `menu_items.preorder_date_locations` (date → location + optional time window),
  `menu_items.physical_pickup` (physical product can also be collected).
- `orders.pickup_location_id` + `pickup_location_name`.
- Buyers never read the table: the storefront feed returns name/city/note only; the
  street address is sent after the order is confirmed (today's privacy).

## Build order
1. **Settings → Pickup & hours**: locations list, add / edit / remove, ★ Set as primary. (web, then iOS)
2. **Product → Pickup**: one location = shows the address as today; 2+ = location
   selector (default primary). Pre-order dates: location per date + optional window.
3. **Storefront + checkout**: picker only when a product is at 2+ locations (incl.
   assorted boxes — fixes two-date boxes); order records location; Orders, Schedule
   and the confirmation / ready emails show it and that location's address.
4. **Physical pickup**: product toggle; checkout "Ship to me" vs "Pick up at…"
   (no shipping address or fee); mixed carts.
5. iPhone editor + order screens (next app build). Until then the app shows the primary.

## Rollout checklist
- [ ] Review migration; apply via `db query -f` (never `db push`).
- [ ] Regenerate both storefront RPCs from live definitions with the new fields.
- [ ] Deploy web + functions together; storefront index.html and next.html identical.
- [ ] Check a single-location shop is unchanged (no picker, same emails).
- [ ] Test Steph-style two-location pre-order end to end.

## Open questions
- Per-location pickup hours, or keep shop-wide hours for now? (Plan: shop-wide.)
- Location choice for Ready Now items in v1, or pre-orders first?

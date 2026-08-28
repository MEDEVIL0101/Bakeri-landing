# Promotions — design & build plan

**Goal:** bakers create promotions from a guided journey. A promotion = a
discount + a target (site-wide / category / specific items) + a schedule
(auto activates/expires) + optionally a promo **code** with its own lifetime
and redemption cap.

---

## 1. What exists today (grounding)

- **One product table:** `public.menu_items`, `listing_kind IN
  ('ready_now','preorder','custom','digital','physical')`. Price =
  `marketplace_price_from` if > 0 else `default_price`. Sub-priced children:
  `listing_variants` (own price + stock), `menu_item_size_tiers` (own price).
- **Storefront data:** `get_baker_web_profile_by_slug(slug)` /
  `_by_id(id)` — `SECURITY DEFINER STABLE`, returns `{profile, listings,
  faqs, links}`. Extended ~15× already; adding fields is the normal pattern.
- **Checkout:** all money runs through edge functions —
  `create-payment-intent`, `create-guest-marketplace-order`,
  `create-guest-quote-payment-intent`, `finalize-guest-digital-order`,
  `finalize-guest-physical-order`, `finalize-guest-digital-physical-order`,
  `pay-invoice-order`, `pay-quote-order`, etc. The charged amount is decided
  server-side there — that's where discounts MUST be enforced.
- **Storefront pages:** `baker/index.html` (+ `baker-lab/`), and checkout
  pages `checkout.html`, `digital-checkout.html`, `physical-checkout.html`,
  `custom-order.html` (inquiry, no charge), `pay-quote.html`.
- No `promo`/`discount`/`coupon`/`sale` anywhere yet — greenfield.

---

## 2. Data model (new)

### `promotions`
| column | notes |
|---|---|
| `id uuid pk` | |
| `user_id uuid` | the baker |
| `name text` | internal label ("Black Friday") |
| `discount_type text` | `'percent'` \| `'fixed_amount'` |
| `discount_value numeric` | percent 0–100, or cents |
| `scope text` | `'site_wide'` \| `'category'` \| `'listing'` |
| `target_categories text[]` | when scope='category' (matches `menu_items.category`) |
| `starts_at timestamptz` | null = starts immediately |
| `ends_at timestamptz` | null = until manually stopped |
| `is_active boolean` | baker's manual on/off, independent of schedule |
| `code text` | null = automatic sale (shows on storefront). non-null = customer must enter it |
| `code_max_redemptions int` | null = unlimited |
| `code_redemption_count int default 0` | |
| `created_at / updated_at` | |

Checks: percent 0–100; fixed_amount > 0; `ends_at > starts_at`; `code`
unique per `user_id` (case-insensitive) when not null.

### `promotion_listings` (scope='listing')
`promotion_id uuid`, `menu_item_id uuid` → FK cascade on listing delete.
PK (promotion_id, menu_item_id).

### (Phase 4, optional) `promotion_redemptions`
`promotion_id`, `email`, `redeemed_at` — only if we add "one use per customer".

---

## 3. Price resolution — the core

**A promotion is *effective now* when:** `is_active` AND
`now() ∈ [coalesce(starts_at,-∞), coalesce(ends_at,+∞))` AND
(`code IS NULL` OR (the matching code was supplied AND
`code_redemption_count < coalesce(code_max_redemptions, ∞)`)).

**It *targets* a listing when:** site_wide → always · category →
`listing.category = ANY(target_categories)` · listing → row in
`promotion_listings`.

**Multiple apply → lowest resulting price wins.** No stacking in v1
(documented, revisitable).

**One shared SQL function** used everywhere:
```
resolve_effective_prices(p_user_id uuid, p_items jsonb, p_code text)
  -> jsonb  -- per line: original_cents, effective_cents, promotion_id, label
            -- + code_status: valid | none | expired | not_started | used_up | unknown
```
- **Storefront RPC** calls it with `p_code = NULL` → only automatic sales
  affect the displayed price. RPC gains per-listing `sale_price`,
  `original_price`, `promo_label`.
- **Checkout edge functions** call it with the buyer's items + entered code,
  recompute the real total, build the Stripe PaymentIntent from that, and on
  finalize do an atomic `UPDATE ... SET code_redemption_count = +1 WHERE
  code_max_redemptions IS NULL OR code_redemption_count < code_max_redemptions`.
- **`validate_promo_code(p_baker_id, p_code)`** — light RPC for the checkout
  page to preview a code before paying (server re-checks at pay time anyway).

Variants/tiers: `percent` cascades onto whatever unit price resolves;
`fixed_amount` comes off the line's unit price (never below 0).

---

## 4. iOS app — the baker journey

**Where:** new **Promotions** screen in Baker Tools (proposed: a row under
the storefront/marketing settings, not a new tab).

**List screen:** promotions grouped Active / Scheduled / Ended, status pills,
"+ New promotion". Row → edit / pause-resume / delete (delete mid-sale
reverts prices immediately).

**Creation wizard:**
1. **Kind** — *Sale* (auto-applies) or *Promo code* (customer enters it)
2. **Discount** — percent or fixed $ off + amount
3. **Applies to** — Everything · Specific categories (multi-select) ·
   Specific items (multi-select from `menu_items`)
4. **Schedule** — start (now / date-time) + end (date-time / no end); show a
   plain-language recap
5. **Code only** — the code string (uppercased, collision-checked) + optional
   total redemption cap
6. **Review → Save**

**Model:** `Promotion` SwiftData model, registered in the `Schema([...])`,
synced by `SyncService`. Baker's own listing rows show an "on sale" marker.

---

## 5. Storefront + checkout web

- **`baker/index.html` / `baker-lab/`:** struck-through original + sale price
  + "Sale" badge on `.p-card`, `.digital-row`, the feature card, and the item
  sheet. Cart math uses sale price. New `--sale` token. Optional site-wide
  sale note in `#announcement-banner`.
- **Checkout pages:** "Have a code?" input → `validate_promo_code` preview →
  discount line in the summary → code passed to the payment-intent function.
- **Edge functions:** recompute with `resolve_effective_prices`; increment
  redemption count atomically on finalize; fail gracefully if a code runs out
  between checkout and pay.
- **Custom/quote items:** the discount applies to the **quoted** price at
  quote-send time (or exclude custom from v1 — decision below).

---

## 6. Phasing

| Phase | Scope | Status |
|---|---|---|
| **1a** | `promotions` schema + `effective_unit_price` / `resolve_effective_prices` / `validate_promo_code` / `redeem_promo_code` + web-profile RPCs return `sale_price` / `promo` | **DONE & LIVE** — migrations `20260828000002`–`000004`. Verified: 15% site-wide applies to digital/physical/ready, skips custom; fixed_amount ignored (v1); promo-code lookup works. |
| **1b** | storefront renders sale UI (struck price + red "Sale" badge + site-wide banner) — `baker-lab` first, then `baker/` | next |
| **2** | Edge functions recompute with active auto promotions so charge = displayed price | ships with 1b (a sale that shows but charges full is not shippable) |
| **3** | iOS app: Market-tab entry → creation journey, list, edit/pause/delete, `Promotion` model + sync | |
| **4** | Promo codes at checkout: code entry on checkout pages, `validate_promo_code` preview, `redeem_promo_code` on finalize, app code fields | |

Build order: 1+2 together (testable in `baker-lab` against hand-inserted
rows), then 3, then 4.

---

## 7. Decisions — LOCKED (2026-08-28)

1. **No stacking.** Biggest discount wins (lowest resulting unit price).
2. **v1 scope targets: `site_wide` + `listing` only.** `category` deferred.
   (`scope` column still has the `'category'` value + `target_categories`
   column so it's a pure additive change later.)
3. **Custom (`listing_kind='custom'`) items are never discounted** — a promo
   (even site-wide) skips them. The quote *is* the price; baker quotes lower
   if they want. The resolver hard-excludes `listing_kind = 'custom'`.
4. **No per-customer code limits in v1.** Only a global
   `code_max_redemptions`. `promotion_redemptions` table dropped from the plan
   for now.
5. **App entry point: the Market tab.** A "Promotions" / "Start a promotion"
   entry there → the list screen → the creation wizard.
6. **Sale colour: the existing red.** Web: `--error` (#C0392B), aliased as
   `--sale`. App: `Color.bakeriRed`.
7. **v1 is PERCENT-OFF ONLY** (2026-08-28, after testing). `fixed_amount`
   applied per-unit lets a "$10 off" code zero a $5 item, and a fixed-dollar
   code means "$X off the order" — order-level plumbing we don't have yet.
   `fixed_amount` stays a legal `discount_type` value; the resolver
   (`effective_unit_price`, `validate_promo_code`) just ignores non-`percent`
   promotions until a later phase adds the order-level path. Migration
   `20260828000004`.

### Banner
Not a separate free-text editor. When a `site_wide` automatic promotion is
active, the storefront auto-fills `#announcement-banner` with a plain recap
("20% off everything") — derived from the promotion, no new baker input.
(`#announcement-banner` today is only driven by shipping settings; this adds
a promo source to `updateAnnouncementBanner`.)

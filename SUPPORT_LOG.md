# Support & Incident Log

Record of customer-reported system problems and how they were fixed —
separate from git history so there's a scannable log of "what broke, why,
who it affected, what fixed it" without digging through commits or chat
transcripts. Newest entries at the top. Append a new entry any time a
customer-reported bug gets root-caused and fixed; don't edit past entries
except to add a resolution/follow-up note.

Entry format:
```
## YYYY-MM-DD — Short title

**Reported by:** who flagged it, how
**Symptom:** what the user actually saw
**Root cause:** the real bug
**Fix:** what changed (files/functions), deployed when
**Affected users:** who was impacted, how they were made whole
**Follow-up:** anything still open
```

---

## 2026-08-28 — resend-digital-download missed a buyer whose digital order was mislabeled "Pickup"

**Reported by:** Diana, directly — a second buyer (wendytippy@hotmail.com) with the expired-link problem. `resend-digital-download` in buyer mode returned "if a matching purchase exists…" (its not-found branch) even though Diana could see the Stripe charge and the baker's app showed the order — as a **Storefront Order → "Ready for Pickup"** with a "Change Pickup Time" button, on an order of three digital sticker/label downloads.

**Root cause:** The order's `fulfillment_type` had been corrupted from `Digital` to `Pickup` — the exact mechanism documented in the 2026-08-24 notifications entry (a baker whose app build predates the `FulfillmentType.digital` case relabels the order to `.pickup` via `SyncService.toModel()`'s `?? .pickup` fallback, then syncs that back to the server). `resend-digital-download` filtered its order lookup on `fulfillment_type = 'Digital'`, so every corrupted digital order was invisible to it. The 2026-08-24 entry's follow-up had explicitly flagged that no audit for this corruption was ever run beyond Cookiesbysteph's account.

**Fix:** [resend-digital-download/index.ts](supabase/functions/resend-digital-download/index.ts) no longer trusts `fulfillment_type` at all. It queries `order_source = 'marketplace'` only, and "is this a digital order?" is now decided purely by whether the line items resolve to a digital listing's file. Sweep mode silently skips orders that resolve nothing (genuine pickup/shipping); named order/buyer lookups surface them. Name→file matching also hardened: fetches the baker's digital listings once and matches a line whose `custom_name` equals or is a separator-delimited prefix of a listing name (handles the `" — "`, `"-pink set"`, `" | Large"` variant-suffix forms), longest unambiguous match wins. Redeployed 2026-08-28; re-ran for wendytippy@hotmail.com — response flipped to "emailed".

**Delivery-email redesign (same day, prompted by Wendy's email looking like a wall of near-identical buttons):** [send-guest-digital-delivery-email/index.ts](supabase/functions/send-guest-digital-delivery-email/index.ts) rewritten to mirror the order **line by line** — one row per item the buyer actually bought, each with that listing's photo (`resolveItemImageUrl`, same resolver as the receipt emails) and its own "Download" button, instead of one deduped button per file. The three callers (`finalize-guest-digital-order`, `finalize-guest-digital-physical-order`, `resend-digital-download`) now emit `downloads[]` one-per-cart-line, labelled with the buyer's own line name (variant suffix included), pass `menu_item_id` per entry for the photo lookup, and — because a variant listing shares one file — sign each distinct file once and append a per-line `&download=<item name>` so each button still saves under its own name. The old behaviour (one link per unique file, labelled with the bare listing name) is gone. On-page success buttons in `digital-checkout.html` / `checkout.html` are unchanged (still text-only, one per line via the same `downloads[]`).

**Affected users:** 14 digital orders, all Cookiesbysteph, 2026-08-20 → 08-25 (Wendy's the outlier; the rest cluster on 08-24/08-25). Every one was created by `finalize-guest-digital-order` (hallmarks: `payment_model='direct'`, `payment_status='captured'`, `platform_fee_cents` set, `marketplace_status='completed'`, `completed_at` set, `scheduled_pickup_date` null) with `fulfillment_type='Digital'`, then the iOS sync flipped it to `'Pickup'`. All 14 buyers had also lost their original 7-day download links to expiry by the time this was found.

**Root cause (corrected):** the `unit='download'` signal in the first draft of this entry was **wrong** — the iOS order-item sync normalizes `order_items.unit` to `'pieces'` on *every* synced marketplace order (the properly-labeled `Digital` ones too), so it can't discriminate. The reliable signal is an order whose line items resolve (by `menu_item_id`, else case-insensitive exact/prefix name match) to one of that baker's own `listing_kind='digital'` listings. Not a storefront routing bug — a real digital sale corrupted post-insert by the `FulfillmentType(rawValue:) ?? .pickup` fallback on Cookiesbysteph's app build (the 2026-08-24 Swift fix needs her to update).

**Remediation (all 2026-08-28):**
- **Buyers:** re-sent downloads to all 11 external buyers via `resend-digital-download` (Wendy + 10). `adrianlwashburn@gmail.com`'s order didn't resolve on the first pass — her 2 lines both read "Zombie Snack Attack Mystery Cookie Bag Printable…" and Cookiesbysteph has **two active listings with that exact name** (one PNG, one PDF). Set `order_items.menu_item_id` on her two rows to the two listings (she gets both versions) and re-sent. The two `cookiesbysteph1@gmail.com` rows are her own test buys — skipped.
- **Baker data + guard:** migration [20260828000001_lock_marketplace_fulfillment_type.sql](supabase/migrations/20260828000001_lock_marketplace_fulfillment_type.sql) — backfills the 13 non-test orders to `fulfillment_type='Digital'`, and adds a silent coerce-back to `orders_sync_conflict_resolution` (BEFORE UPDATE): a client update can no longer move `fulfillment_type` on an `order_source='marketplace'` order (edge functions / RPCs unaffected, INSERT untouched). Chosen over a `RAISE` so an old-build sync push still applies its other field changes.

**Follow-up:**
- Cookiesbysteph's app still needs updating — the guard stops re-corruption server-side, but her local copy shows pickup UI until it pulls the corrected value.
- **Data quality:** she has exact-duplicate digital listings ("Zombie Snack Attack…" ×2, "Dumpling Surprise Mystery Bag Printable | 8.5x11 Foldable…" ×2) and a `"Title: "` prefix artifact on one listing name — cleaning these up would let future orders resolve unambiguously without manual `menu_item_id` patching.
- No other baker showed corrupted digital orders in the audit (query in the migration), but it was only run against the current data — re-run if more digital-order weirdness appears elsewhere.

---

## 2026-08-28 — Digital download links expired after 7 days with no way to get them back

**Reported by:** Diana, directly — a buyer (courtneymeyer12@gmail.com, same buyer as the 2026-08-19 entry) whose download link had stopped working before she downloaded her files. Diana's read: "I suspect this may affect everyone who's done a digital download."

**Symptom:** Buyer clicks the "Download now" link from her purchase email (or the on-page receipt) and gets a Supabase Storage "expired" error instead of the file. No self-serve recovery — the guest has no account, and the link in the email was the only copy.

**Root cause:** `finalize-guest-digital-order` and `finalize-guest-digital-physical-order` mint the Storage signed URL exactly once, at purchase time, with `SIGNED_URL_EXPIRY_SECONDS = 60*60*24*7` (7 days). `send-guest-digital-delivery-email` re-uses that same URL rather than minting its own, so the emailed link and the on-page link die together 7 days after purchase. There was no endpoint to re-issue one, and the order row didn't even record which file it was for (`digital_file_path` lives only on the baker's `menu_items` row; digital `order_items` weren't storing `menu_item_id`). Diana is right that it's systemic: every digital purchase older than 7 days has a dead link.

**Fix:** (files under `supabase/functions/`, deployed 2026-08-28)
- `SIGNED_URL_EXPIRY_SECONDS` raised from 7 days to **1 year** in both `finalize-guest-digital-order` and `finalize-guest-digital-physical-order`. Chosen over "forever" because the URL is a bearer token; 1 year removes the ticket class without an open-ended exposure window.
- Delivery-email copy updated ("this link stays active for a year… reply and we'll send a fresh link").
- Both finalize functions now write `menu_item_id` onto digital `order_items` rows, so future orders resolve straight back to their file.
- **New `resend-digital-download` edge function** — the durable recovery path. Given `{ order_id }` or `{ customer_email }` (or `{ all: true }` for a secret-gated sweep), it walks each order's items back to the file (via `menu_item_id`, else an unambiguous case-insensitive listing-name match, mirroring `resolve_order_item_image_id`), mints a fresh 1-year signed URL, and re-sends the delivery email. `dry_run` reports blast radius without sending. With `x-webhook-secret` it's a full operator tool (echoes URLs, sweep + dry-run); without, it's a locked-down "resend my own links to my own inbox" endpoint that never echoes a URL or confirms an order exists — left public so a storefront "resend" button can use it later.

**Affected users:** Every guest who bought a digital download more than 7 days before their download attempt, across all bakers. Courtney rescued directly via `resend-digital-download` (buyer mode). Broader remediation: run the dry-run sweep to size it, then decide between a one-shot sweep vs. resending per request — no blanket re-email sent yet (consistent with the "no retroactive emails without explicit instruction" practice from the 2026-08-24 notification entry).

**Follow-up:** `resend-digital-download`'s public (no-secret) path isn't wired to any UI yet. No rate limiting on it beyond requiring both a valid order/email — fine while it only emails the address on file, revisit if a storefront button is added. Sweep is paged (`limit`/`offset`, default 50, max 200) to stay under the function timeout — a full sweep of a large backlog needs multiple calls.

---

## 2026-08-24 — Back button after a digital download returned buyers to an already-paid checkout screen

**Reported by:** Diana, directly ("after a digital transaction is completed, a download your file link comes up... when they go back a page, it takes them... back to the page where they are to pay the balance of the bill").

**Symptom:** On `checkout.html`, `digital-checkout.html`, `physical-checkout.html`, and `pay-quote.html`, a buyer who finished paying, clicked the "Download now" (or similar) link, then pressed the browser's Back button, landed back on a payable screen — the pre-payment order form, not the "your download is ready" / receipt screen they'd just seen. It looked like the order hadn't gone through and invited a second attempt to pay.

**Root cause:** `theme.js`'s shared `pageshow` handler (also duplicated inline in `pay-quote.html`) unconditionally calls `window.location.reload()` whenever the page is restored from the browser's back/forward cache (`event.persisted`) — added to stop in-app browsers like Instagram's from silently resuming a stale, previously-visited page state. That reload throws away the in-memory "success" render and restarts the page from scratch, which for these checkout pages means back at the top of the payment flow. Separately, `checkout.html` only cleared its `sessionStorage` cart after the pickup leg of a mixed cart (`finalizeOrder`), so a digital- or ship-only checkout left a stale, already-paid cart sitting in storage too.

**Fix:** `theme.js`'s (and `pay-quote.html`'s) reload now checks a `data-bakeri-no-reload="1"` attribute on `<body>` and skips the reload if it's set. Each checkout page's final success render (`checkout.html`, `digital-checkout.html`, `physical-checkout.html`, `pay-quote.html`) now sets that attribute, so a bfcache restore just leaves the already-correct paid/success DOM in place instead of reloading over it. `checkout.html`'s `renderSuccess()` also now always clears `bakeri_checkout_cart` from `sessionStorage`, not just on the pickup leg. Deployed 2026-08-24.

**Affected users:** Any guest buyer completing a digital, physical/shipping, mixed-cart, or quote/deposit checkout who navigated away (e.g. to their download) and used Back afterward.

**Follow-up:** None open.

---

## 2026-08-24 — No warning that a mixed cart checks out as multiple separate charges

**Reported by:** Diana, directly — flagged that buyers with items from more than one category (pickup + digital, digital + shipping, etc.) see two or three separate "Pay" screens back-to-back with no explanation, which reads as broken and risks someone abandoning partway through with only part of their order (and payment) completed.

**Symptom:** `checkout.html` silently walked a mixed cart through up to three sequential Stripe charges (pickup, digital, shipping) with only a single terse sentence buried in the fine print explaining why — nothing on the summary screen prepared the buyer for a second or third payment screen.

**Root cause:** Design gap, not a code defect — pickup items (authorize-then-capture-on-accept) can't share a PaymentIntent with digital or shipping items (instant capture), so the multi-charge flow itself is a real Stripe constraint, but the UI never surfaced that up front.

**Fix:** `checkout.html`'s order summary now shows a prominent notice up front when a cart spans more than one category, listing exactly how many charges there will be, what each pays for, and warning that stopping partway leaves the rest of the order unplaced. Each subsequent pay screen also now shows a "Step X of Y" label and how many charges remain. Deployed 2026-08-24.

**Affected users:** Any guest buyer checking out a cart with items from more than one category (pickup/digital/shipping combined).

**Follow-up:** A true single-charge checkout (one payment, one confirmation screen) was discussed as the better long-term fix but needs a backend redesign — pickup's authorize-then-capture-on-accept hold can't currently share a charge with digital/shipping's instant capture. Revisit if abandonment on mixed carts is still a problem after this messaging change.

---

## 2026-08-24 — Past Orders showed the wrong status screen for marketplace orders

**Reported by:** Diana, directly, after checking the cookie jar order's fix from earlier tonight ("it's being displayed as if it were a food item, with status bar options: baked; decorated; packaged... it shouldn't be like that").

**Symptom:** Opening the delivered "Bakeri Cookie Jar" order (a physical/shipping marketplace order) from Past Orders showed `OrderDetailView` — the manual-order kitchen-workflow screen — complete with Confirmed/Baked/Decorated/Packaged status chips, which don't apply to a marketplace order at all.

**Root cause:** `CompletedOrdersView`'s row tap handler always set `selectedOrder`, routed by a single `.navigationDestination(item:)` straight into `OrderDetailView`, with no branch on `order_source`. `OrdersView.swift`'s own order list has always correctly branched — `isMarketplaceOrder ? selectedMarketplaceOrder : selectedOrder`, two separate destinations — but `CompletedOrdersView` (a separate, parallel screen; see the 2026-08-24 "delivered orders missing" entry above for the other independent bug already found in this same screen) never got that branch.

**Fix:** Added the same `isMarketplaceOrder` branch and a second `@State`/`.sheet(item:)` presenting `MarketplaceOrderSheet` for marketplace orders, matching `OrdersView.swift` exactly. `OrderDetailView` (unchanged) still handles manual orders via `.navigationDestination(item:)`, since `MarketplaceOrderSheet` manages its own internal `NavigationStack` and is presented as a sheet everywhere else it's used. Also removed the "Add Reference Photos" section for digital orders (already removed for shipping orders when that layout was redesigned) — a digital download has no physical item to photograph, so there's nothing to add a reference photo to. Deployed 2026-08-24 (client-side, needs the new build).

**Affected users:** Any baker opening a marketplace order (not just physical/shipping — digital, ready_now, custom, etc. too) from Past Orders specifically. The main Orders tab was never affected — only this second, parallel screen.

**Follow-up:** None open.

---

## 2026-08-24 — Bakers never notified of a digital sale (or any marketplace order/quote)

**Reported by:** Diana, directly ("make sure that digital file sales are triggering notifications... they should get an email saying they sold x product").

**Root cause (two independent bugs found investigating one real sale):**

1. **Baker notification emails were broken for every sale/order/quote type, not just digital.** `sendBakerOrderEmail` is called from 4 places (`finalize-guest-digital-order`, `finalize-guest-physical-order`, `create-guest-marketplace-order`, `submit-custom-order-inquiry`), all gated on `if (bakerProfile?.email)` from a plain `profiles` table select. `profiles.email` is *never actually populated* — `20260601000003_profiles_column_security.sql` explicitly excludes it from the app's own profile reads with the comment "app reads it from auth.session, not profiles." Nothing in the app or any edge function writes to it. So for any baker whose `profiles.email` happened to be blank (confirmed live: Cookiesbysteph's was `""`), the entire notification block — including the `notification_log` write — was silently skipped. No error, no failed-status log row, nothing. (One baker, Sugarland, had it populated for unknown/legacy reasons, which is why her sale email worked and made this easy to miss as a systemic issue at first.)

2. **Separate, unrelated data-corruption bug found in the same investigation:** `FulfillmentType` (the iOS `Order` model's fulfillment enum) had no `.digital` case — only `pickup`/`delivery`/`shipping` — even though `finalize-guest-digital-order` inserts `fulfillment_type: "Digital"` server-side. The first time a baker's device pulled such an order, `SyncService.toModel()`'s `FulfillmentType(rawValue:) ?? .pickup` fallback silently relabeled it "Pickup" locally, and a subsequent sync push wrote that corrupted value back to the server — confirmed live on Cookiesbysteph's test sale, whose `fulfillment_type` flipped from "Digital" to "Pickup" ~6 minutes after creation. **Update:** turned out to affect all 34 of her real digital sales going back to 2026-08-17, not just the one test order — every single one had `fulfillment_type` corrupted to "Pickup". Identified precisely (she has exactly one non-digital purchasable listing type — a "custom" quote request — and her one physical listing was never even marketplace-listed, so it could never have been bought) and repaired directly in the database: all 34 set back to "Digital", the 1 custom-quote order left untouched. No retroactive emails sent for any of these, per explicit instruction.

3. **A third, more significant gap, found answering the baker's own follow-up question ("Is there a way to get notifications when you get orders?", asked live, same night — her device notification permissions were confirmed fine):** baker-facing *push* notifications for a new order only ever fire from `trg_fn_marketplace_order_notify`'s `INSERT` branch, which only matches `marketplace_status = 'pending'` (ready_now/preorder) or `'pending_quote'` (custom quote). Both `finalize-guest-digital-order` (inserts straight to `'completed'`) and `finalize-guest-physical-order` (inserts straight to `'awaiting_shipment'`) skip that branch entirely — so a baker got **no push at all** for a digital or physical sale, not because of a notification-settings problem, but because the code never attempted to send one in the first place. This is exactly what Cookiesbysteph was noticing.

**Fix:**
- New `_shared/bakerEmail.ts` (`resolveBakerEmail`) resolves the baker's real address via the Supabase Auth Admin API (`auth.admin.getUserById`) instead of trusting `profiles.email`, falling back to it only if that lookup fails. Wired into all 4 call sites above. Deployed 2026-08-24.
- Added `FulfillmentType.digital` to `Order.swift`; excluded it from `AddEditOrderView`'s manual fulfillment-type picker (server-only value, never baker-selectable) and added the missing cases to two now-non-exhaustive switches (`OrdersView.fulfillmentIcon`, `OrderDetailView.fulfillmentPillColor`/`fulfillmentPillIcon`). Requires a new app build to reach devices.
- New `_shared/postWithRetry.ts` (shared retry wrapper for calling another internal edge function; existing near-duplicates in `mark-order-shipped`/`mark-order-delivered`/`cancel-order` left as-is, not retrofitted). `finalize-guest-digital-order` and `finalize-guest-physical-order` now each also send the baker a push via `notify-marketplace`, reusing the existing `type: "new_order"` notification type (baker-only routing, no iOS changes needed since `NotificationClickRouter` already treats that type as unambiguous). Deployed 2026-08-24.

**Affected users:** Every baker, for every one of the 4 order/sale/quote email types, whenever `profiles.email` was blank (the norm, not the exception) — plus every baker, for every digital or physical sale specifically, who never got a push notification at all regardless of email. Cookiesbysteph's one real test sale got its retroactive "You just made a sale!" email sent manually after the fix (confirmed delivered to her real address); no other retroactive emails were sent for her other 33 historical sales, and none are planned. All 34 of her digital orders' corrupted `fulfillment_type` were repaired back to "Digital" directly in the database.

**Follow-up:** No sweep was run for *other bakers'* existing orders that may have had `fulfillment_type` similarly corrupted before the client-side fix ships (only Cookiesbysteph's account was audited and repaired). A proper audit would check every `order_source = 'marketplace'` order for a `fulfillment_type` inconsistent with what its actual sale implies — worth doing if more digital-order weirdness turns up elsewhere. The new push notifications (digital/physical sale) haven't been verified against a real live purchase yet, only reasoned from the already-proven `notify-marketplace`/`postWithRetry` mechanism used successfully elsewhere — worth a real test purchase to confirm end-to-end once there's time.

---

## 2026-08-24 — Delivered physical orders missing from "Past Orders"

**Reported by:** Diana, directly ("the user sugarland is suddenly not seeing their past orders").

**Symptom:** Sugarland's "Bakeri Cookie Jar — Small" order (a physical/shipping marketplace order, `marketplace_status = 'delivered'`) didn't appear in the Past Orders screen, even though it was fully intact server-side (not deleted, not otherwise abnormal).

**Investigation note:** first ruled out data loss — 3 other, unrelated orders on this account *were* genuinely soft-deleted (`deleted_at` set), but all three on 2026-08-21, via the app's own "Delete Order" confirmation (`OrderDetailView.swift`, the only code path that ever writes `orders.deleted_at`), and none of them was the cookie jar order. That's a separate, non-bug event (deliberate delete, `deleted_at` timestamp frozen at the 21st, nothing changed since) — not what caused this report, and the data was left untouched.

**Root cause:** `CompletedOrdersView.swift`'s `@Query` predicate only matched `marketplace_status == "completed"`. `20260823000001_physical_order_lifecycle.sql` (this same day, earlier session) introduced `"delivered"` as a physical order's own terminal status, distinct from `"completed"`. `OrdersView.swift`'s own completed-orders filter was updated for this at the time, but `CompletedOrdersView.swift` — a separate, parallel screen reachable from the sidebar's "Past Orders" menu item — has its own independent filter that was missed, so every delivered shipping order silently stopped appearing there.

**Fix:** Added the `"delivered"` case to `CompletedOrdersView.swift`'s filter. Along the way, the original 3-condition `#Predicate` macro failed to compile ("unable to type-check this expression in reasonable time") once the third OR'd condition was added — switched to an unfiltered `@Query` + plain Swift `.filter`, the same pattern `OrdersView.swift` already uses for this exact reason. Requires a new app build to reach devices (client-side only, no backend change).

**Affected users:** Any baker with a physical/shipping order that reached "Delivered" — invisible specifically in Past Orders (sidebar), not in the main Orders tab's own Completed section, which was already correct.

**Follow-up:** None open. Worth remembering for future new terminal-ish marketplace statuses: `OrdersView.swift`'s `completedOrders` and `CompletedOrdersView.swift`'s filter are two independent, unlinked copies of the same logic and must be updated together.

## 2026-08-20 — Digital cart items couldn't be removed without leaving the page

**Reported by:** Diana, directly ("I noticed that a user can't remove digital products from the cart- they have to go back to the users page and deselect them there").

**Root cause:** `baker/index.html`'s cart sheet already had a working remove (✕) button for digital lines, but it was unreachable in the one case that actually mattered: when the cart held *only* digital items (no pickup lines), both `openCartSheet()` (tapping the header cart icon) and the floating digital-cart bar's click handler (`goToDigitalCheckout()`) skipped the sheet entirely and jumped straight to `digital-checkout.html` — a page with no line items or remove control at all, just a name/email form. The only way out was navigating back to the listing itself and deselecting it there.

**Fix:** [baker/index.html](baker/index.html) — `openCartSheet()` no longer bypasses to a checkout page; it always opens the cart sheet first, where every line (pickup, digital, and the new "ships" line kind — see below) is removable. The sheet's own Continue button now decides where to go next (full pickup-info step vs. straight to a lighter single-purpose checkout page) based on what's actually in the cart. Also fixed a related staleness bug found while verifying this live: removing a digital item via the sheet updated the cart total but left the underlying Digital Downloads row still showing "✓ added" until the page reloaded — `renderDigitalFeed()` is now re-run on removal too.

**Affected users:** Any buyer whose cart was digital-only, across any baker's storefront — not isolated to one report.

**Follow-up:** None open — verified live against a real storefront (Sweet Southern Bakery): add → cart bar → sheet opens → ✕ removes → underlying row updates immediately, all without a page reload.

---

## 2026-08-19 — "Payment succeeded but we were unable to process your download"

**Reported by:** Diana, relaying a screenshot from a buyer (courtneymeyer12@gmail.com) — Stripe's Payment Link confirmation page showed "Payment succeeded but we had trouble preparing your download — contact the baker with this reference: pi_3U6FLuRpvLcm5nZI0HBkulFF." Diana confirmed in the Stripe dashboard that the payment intent had genuinely succeeded. Buyer also mentioned having to check out 7 separate times to buy 7 digital items from the same baker (Cookiesbysteph).

**Root cause:** Two separate bugs, both in the digital-download guest checkout (`baker/digital-checkout.html` → `create-payment-intent` → `finalize-guest-digital-order`):
1. `create-payment-intent` created and captured the Stripe charge from client-supplied item data alone, with **no server-side check** that the digital listing still existed, was still listed, or still had a file attached. `finalize-guest-digital-order` (called after payment) *did* validate all of that — but by then the money had already moved, so any listing edited/unlisted/deleted between page load and checkout charged the buyer and then failed to deliver, with no automatic recovery. Confirmed against the reported payment intent: it shows `succeeded` in Stripe, but no matching `orders` row was ever created.
2. There was no multi-item digital cart — every digital item was its own solo checkout page (`?item=<id>`), forcing a buyer with several items to run the whole payment flow once per item. Each repeat run was another chance to hit bug #1.

**Fix:** [create-payment-intent/index.ts](supabase/functions/create-payment-intent/index.ts), [finalize-guest-digital-order/index.ts](supabase/functions/finalize-guest-digital-order/index.ts), [send-guest-digital-delivery-email/index.ts](supabase/functions/send-guest-digital-delivery-email/index.ts), [baker/digital-checkout.html](baker/digital-checkout.html), [baker/checkout.html](baker/checkout.html), [baker/index.html](baker/index.html) — deployed 2026-08-19:
1. `create-payment-intent` now re-fetches every digital item server-side and rejects unlisted/deleted/fileless items *before* charging.
2. `finalize-guest-digital-order` now auto-refunds via Stripe if it still can't deliver after a confirmed payment (closes the remaining race window instead of leaving a "contact the baker" dead end), and no longer blocks delivery on `is_listed_in_marketplace` once payment is confirmed — the buyer already paid, so it still delivers if the file exists.
3. Digital checkout now supports a real multi-item cart (`digitalCart` in `baker/index.html`, `finalize-guest-digital-order` accepts `menu_item_ids`), and a cart mixing pickup items + digital downloads checks out as one guided flow (two Stripe charges under the hood — a pickup item's authorize-then-capture can't share a PaymentIntent with a digital item's instant capture).

**Affected users:** The reporting buyer's order for "Girl Dumpling face" ($1) was manually completed after the fix — order created, download link generated and emailed — rather than refunded, since the charge had genuinely succeeded. No other confirmed reports at time of fix; the underlying charge-before-validate gap could have affected any digital-listing buyer across any baker.

**Follow-up:** None open — root cause fixed at the source (charge-time validation) with an auto-refund safety net for any remaining edge case, and multi-item digital carts should reduce how often buyers repeat checkout at all.

---

## 2026-08-16 — Storefront screen "zoomed in hardcore" after setting a header photo

**Reported by:** A baker, via Diana — screenshot showed "Your Storefront" with text clipped at the edges across multiple sections, unable to see the whole screen. Baker clarified the screen was normal until she set her header picture, and it's "been stuck like that ever since."

**Root cause:** `UIImage.downsampledForStorage(maxDimension:quality:)` in [Extensions.swift](Extensions.swift) resized images with `UIGraphicsImageRenderer(size:)` and no explicit format, which defaults to the device's native screen scale (2x/3x on Retina devices). The JPEG encode bakes in the actual rendered pixel buffer, so a "1600pt" header photo was physically stored as ~4800×2700+ pixels on a 3x device. On reload, `UIImage(data:)` defaults to scale 1.0, so it reports that inflated pixel count back as points — the image renders several times larger than intended, every single time that data loads. Deterministic and tied exactly to the reported trigger: broken the moment the header photo was picked, persists because the oversized file is what's actually stored. The sibling `preparedForAI(maxSide:)` (feeds the Claude vision API) had the identical bug.

**Fix:** Two parts, in [Extensions.swift](Extensions.swift), [BakeryProfileEditorSection.swift](Bakerly/Bakerly/Bakeri/Views/Settings/BakeryProfileEditorSection.swift), and [BakeryAboutEditorSection.swift](Bakerly/Bakerly/Bakeri/Views/Settings/BakeryAboutEditorSection.swift):
1. Pinned `UIGraphicsImageRendererFormat().scale = 1` on the renderer in both `downsampledForStorage` and `preparedForAI` in Extensions.swift, so new stored images are 1:1 points-to-pixels going forward.
2. Self-heal for already-broken data: added `UIImage.isPlausiblyIntact` (rejects a decoded image whose longest edge is absurdly large — well beyond anything the fixed encoder would produce). The header-image and about-portrait render paths now only display data that passes this check, and each section runs a `.task` on appear that auto-clears (`= nil`) any stored image that fails it. This matters because `storefrontHeaderData` is a **local file only** (Application Support, not a synced table/column) — investigated whether a server-side clear could self-heal her device and confirmed it can't: `SyncService.syncAll()` only pulls from Supabase Storage (`storefront-headers/{userID}/header.jpg`) when no local file exists, so with her broken file already present locally it would just keep re-pushing the bad file, undoing any server-side fix. The affected baker (or anyone hit by this) needed a way to recover that didn't depend on successfully navigating the broken screen — this makes recovery automatic on next app open instead.

Logo turned out unaffected — `LogoEditorSheet.cropToCircle()` already pinned `format.scale = 1` independently, so it was never part of this bug.

Verified with a clean `xcodebuild` simulator build (`BUILD SUCCEEDED`). Not yet deployed — needs a build + release.

**Affected users:** Any baker on a 2x/3x device who set a storefront header image or about-portrait, storing a physically oversized image. One confirmed report so far. Once this ships, affected bakers self-heal automatically on next app open (falls back to the normal empty "Add Image" state) — no manual remove/re-add needed. If the reporting baker had already published, her live public storefront (reads straight from Supabase Storage) may still show the bad header until she re-adds and republishes — that part isn't automatic.

**Follow-up:** Ship the build. Check in with the reporting baker after release to confirm the screen self-heals and, if she'd published, that her public storefront looks right after re-adding a header photo.

---

## 2026-08-13 — Inspiration-photo picker kept resetting to the top while scrolling

**Reported by:** Customer "sugardnotescookieco", via Diana — said they'd tried across multiple days; every time they scrolled down in the photo picker to attach inspiration images to a custom order, it snapped back to the top before they could tap a photo, making it impossible to select anything below the first screen.

**Root cause:** Two `PhotosPicker` usages — the "inspiration photos" picker on the customer-facing custom-order-request screen (`CustomRequestDetailView` in [ItemDetailView.swift](Bakerly/Bakerly/Bakeri/Views/Marketplace/ItemDetailView.swift)) and the photo-answer field in baker-built intake forms (`PhotoFieldView` in [DynamicIntakeFormView.swift](Bakerly/Bakerly/Bakeri/Views/Marketplace/Forms/DynamicIntakeFormView.swift)) — reset their `selectedPickerItems` binding to `[]` at the end of the `onChange` handler. `PhotosPicker` fires `onChange` live on every tap while its sheet is still open, not just once at the end, so clearing the binding mid-session fought the picker's own selection/scroll state and snapped it back to the top. The identical bug had already been found and fixed in the baker-facing order pickers (`AddEditOrderView.swift`, `MarketplaceOrderSheet.swift`) but two customer-facing pickers still had the old pattern.

**Fix:** Applied the same fix already proven elsewhere in the codebase — track processed items by `itemIdentifier` in a `Set<String>` and dedupe instead of clearing the binding, so already-loaded photos aren't reprocessed but the picker's own state is never touched. Changed in both files above. Shipped to TestFlight/App Store.

**Affected users:** Any customer attaching inspiration photos to a custom order request, or answering a photo field in a baker's custom intake form, whenever their photo library had more images than fit on one picker screen. sugardnotescookieco is the confirmed report; likely affected others silently since this shipped.

**Follow-up:** Consider a lint/pattern check to catch `selectedPickerItems = []`-after-`onChange` recurring a third time.

---

## 2026-08-08 — Baker never notified when a customer paid an invoice balance (or deposit) via a payment link

**Reported by:** Harvey, live — got a push when a deposit was paid, but nothing when the remaining balance on that same order was paid moments later via an invoice link.

**Symptom:** No push notification to the baker after a buyer pays a `/pay/` invoice link — neither the deposit nor the balance leg.

**Root cause:** `finalize-invoice-payment` (the buyer-facing endpoint the static `/pay/` page calls after Stripe confirms the charge) had zero notification code of its own — it relied entirely on `trg_fn_marketplace_order_notify`, the generic DB trigger that fires on a `marketplace_status` *transition*. But this function's deposit branch never touches `marketplace_status` at all, and its balance/full branch only sets it when the order was still pre-payment (`pending`/`pending_quote`/`quote_provided`/`null`) — by the time a *balance* gets paid, the order is already `confirmed` from the deposit leg, so no transition ever happens and the trigger has nothing to fire on. The deposit push Harvey did see came from a different path (`finalize-guest-quote-payment`, the in-app quote-acceptance flow, which does flip `marketplace_status` and correctly rides the generic trigger) — not from an invoice link at all.

**Fix:** [finalize-invoice-payment/index.ts](supabase/functions/finalize-invoice-payment/index.ts) now sends a best-effort push directly to the baker after any successful invoice payment (deposit/balance/full), via `notify-marketplace` — the same direct-call pattern `mark-order-ready-for-pickup` already established, chosen specifically because it doesn't depend on a status transition that may or may not occur. Tagged `type: "quote_paid"` so tapping it routes to Baker Orders like every other payment-received push. Deployed 2026-08-08.

**Affected users:** Every baker using invoice-link payments (manual orders and guest-quote balances) — this path never notified on payment, silently, since the feature shipped.

**Follow-up:** None open.

---

## 2026-08-08 — Order status didn't update in the app until closing and reopening it

**Reported by:** Harvey, live — baker in the app when a customer's payment went through: got the push notification, but the order's on-screen status stayed stale until force-closing and reopening the app.

**Symptom:** A push notification arrives while the app is already open; the order list/detail view doesn't reflect the change it describes.

**Root cause:** The app only re-syncs from Supabase on two triggers: `scenePhase` becoming `.active` (backgrounding/reopening), or a 5-minute foreground timer ([BakeriApp.swift:149-167](Bakerly/Bakerly/Bakeri/BakeriApp.swift), [ContentBootstrapper](Bakerly/Bakerly/Bakeri/BakeriApp.swift) `syncTimer`). A push that arrives while the app is already open doesn't change `scenePhase` (it's already `.active`), so neither trigger fires — the baker was stuck seeing stale SwiftData-backed UI for up to 5 minutes, or until they backgrounded/reopened the app (which re-triggers `.active`).

**Fix:** Added `NotificationForegroundSyncListener`, a OneSignal `OSNotificationLifecycleListener` registered via `addForegroundLifecycleListener` ([BakeriApp.swift](Bakerly/Bakerly/Bakeri/BakeriApp.swift)), which fires `SyncService.shared.syncAll()` the moment a push is about to display — the same sync the scenePhase/timer triggers already run, just immediately instead of waiting. Doesn't call `event.preventDefault()`, so the notification banner itself still displays exactly as before; this only adds a sync as a side effect. Verified builds clean against the real OneSignal 5.5.1 SDK (confirmed exact protocol/method names from the installed framework headers rather than guessing).

**Affected users:** Every baker with the app open when any push-worthy event happens — not specific to payments, applies to every notification type.

**Follow-up:** None open — not yet verified against a real device/simulator run (only build-verified); flag if a foreground push still doesn't refresh the UI.

---

## 2026-08-08 — Undo Mark as Completed silently reverted a real balance payment

**Reported by:** Harvey, live — used the new "Undo Mark as Completed" button (OrderDetailView), and the order came back saying the balance needed to be paid again, even though it had genuinely already been paid online via an invoice link minutes earlier.

**Symptom:** After undoing a completed order, `is_paid`/`paid_at` reverted to their pre-payment values — a real payment record silently disappeared, no error shown anywhere.

**Root cause:** A real asymmetry in the sync layer, not something specific to the undo feature — undo just happened to be the thing that finally triggered it. `pullOrders` (SyncService.swift) is timestamp-guarded: it only applies a server row to the local SwiftData copy `if row.updatedAt > local.updatedAt`, so a pull can never overwrite a locally-fresher edit. But `pushOrderNow`/`schedulePush` have no equivalent protection at all — they unconditionally upsert the *entire* local row over whatever the server has, regardless of which side is actually fresher. The undo code called `order.touch()` (bumping the local row's `updatedAt` to "now") and then pushed — but the local copy's `is_paid`/`paid_at` were stale: the balance had been paid through `finalize-invoice-payment`, a path that runs entirely server-side when a guest pays a `/pay/` link, which never syncs down to the baker's device on its own. `touch()` made the stale local row *look* newest without actually refreshing its stale fields, and the unconditional push then clobbered the server's correct payment data with it. Silent, because the push itself succeeded — there was nothing to surface as an error.

**Fix:** [OrderDetailView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/OrderDetailView.swift)'s `undoMarkAsCompleted()`: for a marketplace order, the `undo_order_completion` RPC is already the sole server-side write needed — removed the push entirely and pull (`SyncService.syncAll`) instead, so this device's copy of everything else (payment fields especially) gets reconciled from the server without ever risking writing stale local data back. For a plain manual order (no RPC covers that case, so *some* push is still necessary to persist the status change), pull first to narrow the same staleness window before editing and pushing. Manually repaired the one order this hit live (`is_paid`/`paid_at` restored from context, `updated_at` bumped so the fix is guaranteed to sync back down to the device rather than getting skipped by the very same freshness guard).

**Affected users:** One test order today. The underlying push-side gap is broader, though — anywhere else in the app that edits a locally-cached order and then pushes it (schedulePush/pushOrderNow) carries the same theoretical risk if that order was also recently touched by a path that doesn't sync to this device (guest invoice payments, another baker device, etc.). `markUnpaidButton` (same file) already had this exact edit-then-push shape before today and wasn't touched by this fix — flagged, not fixed, since it's pre-existing and out of scope for this pass.

**Follow-up:** Consider a real fix at the sync layer itself (e.g. a pull-before-push helper, or per-field/partial updates instead of whole-row upserts) rather than patching each call site piecemeal — `markUnpaidButton` and potentially others still carry the same risk.

---

## 2026-08-08 — Custom order form showed customer details twice on the web

**Reported by:** Harvey, relaying a baker report (Sugarland/Harriet Sterling) — a customer filling out the "Sugar Cookies Order Form" custom-order link had to enter their name/email/phone, then immediately enter it again as "the proper form" began. The baker's own in-app preview looked correct.

**Symptom:** Web guest custom-order form (`baker/custom-order.html`) showed a full duplicate contact section at the top, ahead of the baker's actual form.

**Root cause:** Two independent implementations of the same "collect contact info" step, out of sync. Every form built in the app's builder is seeded with real, persisted fields via `defaultCustomerDetailsFields()` ([IntakeFormBuilderView.swift:126](Bakerly/Bakerly/Bakeri/Views/Marketplace/Forms/IntakeFormBuilderView.swift:126)) — a "Customer Details" heading + First Name/Last Name/Email/Phone Number — which is exactly what the baker sees in the builder and what the in-app preview renders (`DynamicIntakeFormView`, the same component real in-app orders use, so it never drifts). But `baker/custom-order.html` is a separate hand-rolled page that *also* unconditionally rendered its own hardcoded name/email/phone block before looping through the form's own fields — so a form using the standard default always duplicated. The baker's in-app preview never touches this web-only code path, so it looked fine there.

**Fix:** [baker/custom-order.html](baker/custom-order.html) now detects the standard block (heading literally "Customer Details" immediately followed by fields labeled exactly "First Name"/"Last Name"/"Email"/"Phone Number" — the exact default the builder seeds) and skips rendering those specific duplicate fields, feeding their answers to the server from the one remaining fixed block's inputs instead (`detectStandardContactFields`/`isHiddenStandardField`). A field the baker renamed, removed, or reordered past a gap falls through untouched and just renders normally — this only ever hides an exact match, never guesses. The fixed block's single "Your name" input was split into separate First/Last name fields so the mapping onto the builder's default schema is exact, no name-splitting heuristics. Verified against Sugarland's real live form data (menu item `8be8505a-b429-4813-9fc2-64c548ade495`) via a local server with the network call intercepted — single contact section renders, then Sugarland's actual questions (Delivery Date, Time of Day, dozen count, designs, occasion, theme, packaging, ribbon colour) follow with no gap, and the submitted payload correctly carries synthesized answers for the four hidden fields so the server's required-field check still passes.

**Side note also resolved:** the "confirm your email" mechanism the report also asked for already existed in this same fixed block (matching-value validation, paste/copy/cut disabled to prevent silently pasting a typo twice) — it just lived in the half of the page that was previously redundant. It's now the sole, correct copy. Scoped to web only for now, per Harvey's call — the in-app flow (`DynamicIntakeFormView`) doesn't have confirm-email and wasn't touched.

**Affected users:** Every baker whose custom-order form uses the builder's default "Customer Details" block and gets guest (web, non-app) submissions — not unique to Sugarland.

**Follow-up:** Not yet committed/pushed — `baker/custom-order.html` is served live via GitHub Pages off `main`, so this fix isn't live until pushed.

---

## 2026-08-08 — No way to resend a "ready for pickup" email, and reopening a completed order re-showed the completion screen

**Reported by:** Harvey, live — a baker hit the "couldn't confirm the customer's notification went through" warning (the honest-failure signal added 2026-08-07) while trying to resend a ready-for-pickup email, but the only way to trigger that send was "Change Pickup Time" — with no dedicated resend action, the baker apparently reached for "Mark Order as Completed" by mistake instead, closing the order. Going back into the order afterward to undo it, the baker got the "Transaction Complete" screen every time they opened it from the past-orders list.

**Symptom:** Two separate gaps compounding: (1) no way to resend the ready-for-pickup notification without also opening the reschedule sheet and re-saving a pickup time; (2) `BakerTransactionCompleteView` reappeared on every subsequent open of an already-completed order, not just the one right after completion.

**Root cause:** (1) `mark-order-ready-for-pickup` was only ever called from "Mark Ready for Pickup" (first time) or "Change Pickup Time" (reschedule) — there was no action that just resends without changing state. (2) `refreshOrderStatus()` in [MarketplaceOrderSheet.swift](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/MarketplaceOrderSheet.swift) fires the transaction-complete cover whenever it fetches `marketplace_status == "completed"`, guarded only by `!showingTransactionComplete` — a plain `@State` that starts `false` on every fresh instantiation of the sheet. Since `.task` calls `refreshOrderStatus()` unconditionally on open, opening *any* already-completed order re-triggered the same "just completed" cover every time.

**Fix:** Added a "Resend Notification" button next to "Change Pickup Time" (ready_for_pickup status only) that calls the existing `confirmReadyForPickup` save-and-notify path with the order's already-saved pickup date/window unchanged, via new `resendReadyForPickupNotification()`. Added `wasCompletedOnOpen`, captured once from the order's local status before the first `refreshOrderStatus()` call each time the sheet opens; both places `refreshOrderStatus()` sets `showingTransactionComplete` now also check `!wasCompletedOnOpen`, so the cover only fires on a genuine completed transition during that viewing session, not on reopening a past order.

**Affected users:** Any baker resending a ready-for-pickup notification (no dedicated action existed before), and any baker reopening a completed order from their orders list (would always re-show the completion screen).

**Follow-up — root cause of the original `notified: false`, added after further investigation:** Queried `notification_log` directly for the order in question (`ca04d25b-a5d6-4790-8c2f-501e4ccfcac5`) and found **zero rows** for `guest_order_ready` — not even a `failed` one, even though the pickup-window DB write itself had clearly succeeded (the time was saved and displayed correctly). Since `send-guest-order-ready-email` logs both outcomes from inside its own try/catch, a missing row means the request never reached that point at all — ruling out a bug *in* that function. Also ruled out a `BAKERI_WEBHOOK_SECRET` mismatch between the two functions (confirmed via `supabase secrets list`: it's a single project-wide value, not per-function, so it can't drift out of sync). Other `guest_order_ready` sends from the same day succeeded cleanly, so this wasn't systemic — pointing at a transient failure in the edge-function-to-edge-function `fetch()` call itself (cold start / timeout), the same category of issue called out in the entry below this one. [mark-order-ready-for-pickup/index.ts](supabase/functions/mark-order-ready-for-pickup/index.ts): `postWithRetry` now backs off with increasing delay (0/600/1400/2600ms instead of a flat 800ms×3) to give a slow cold start more room, and — closing the actual "zero trace" gap — now writes its own `notification_log` row on final failure for *both* the push and guest-email paths, so a future occurrence is visible without cross-referencing the order and the log by hand. `logNotification` ([_shared/notificationLog.ts](supabase/functions/_shared/notificationLog.ts)) gained an optional `channel` param (defaults to `"email"`, backward-compatible with every other caller) to support logging the push path too. Deployed 2026-08-08.

**Follow-up 2 — the retry-backoff theory above was wrong; real cause found, and the resend button had a second, more serious bug:** After deploying the retry/logging fix, the baker retried and got the *same* "Something went wrong" alert on 100% of attempts (not intermittent, contradicting the cold-start theory). The new durable logging paid off immediately: `notification_log` showed `{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` on every attempt. `send-guest-order-ready-email` keeps Supabase's platform-level JWT verification ON (`verify_jwt: true`, confirmed via `supabase functions list`) by deliberate design — the same pattern already documented for three sibling guest-webhook functions in [20260714000012_guest_webhook_calls_add_apikey.sql](supabase/migrations/20260714000012_guest_webhook_calls_add_apikey.sql), which requires every caller to add the public anon key as `apikey`/`Authorization` headers on top of the function's own `x-webhook-secret` check. `mark-order-ready-for-pickup` (written 2026-08-07/08) never did this — `postWithRetry`'s fetch only ever sent `x-webhook-secret`. It had likely been broken from day one; a project-wide Supabase key/JWKS rotation that day (visible via `supabase secrets list` timestamps) appears to be what made the platform gate start strictly enforcing it on every call instead of occasionally. Fixed by adding the anon key as `apikey`/`Authorization` headers to `postWithRetry`. Deployed 2026-08-08.

Separately, once headers were fixed and the baker could actually resend, a second bug surfaced: the resend sent (and *saved*) a pickup time from a different, earlier test order — not this order's real one, and worded as "pickup time updated" instead of a plain resend. Root cause: "Resend Notification" reused `confirmReadyForPickup`, which is a save-*and*-notify call built for "Change Pickup Time" — it always writes whatever pickup date/window the Swift sheet's `@State` currently holds. If that cached state is ever stale (exact mechanism unconfirmed — possibly SwiftUI view/state reuse across a previously-viewed order's sheet), a "resend" doesn't just send a wrong notification, it **overwrites the order's actual saved pickup time** with the stale one. Fixed properly rather than patched: `mark-order-ready-for-pickup` gained a `resend_only` mode that takes no pickup date/window from the client at all, reads `scheduled_pickup_date`/`pickup_window_start`/`pickup_window_end` straight from the order row, never writes to `orders`, and always frames the email as the original "ready for pickup" (never "time updated"). [PaymentService.swift](Bakerly/Bakerly/Bakeri/Services/PaymentService.swift) gained a dedicated `resendReadyForPickupNotification(orderID:)` calling this mode; [MarketplaceOrderSheet.swift](Bakerly/Bakerly/Bakeri/Views/Orders/MarketplaceOrderSheet.swift)'s resend button now calls that instead of `confirmReadyForPickup`. Deployed 2026-08-08. Not yet re-verified live by the baker.

---

## 2026-08-08 — Bakers couldn't find their Stripe balance, looked like payouts were broken

**Reported by:** Harvey, live — a baker (Tilly) made a sale and, checking Stripe, saw $0 pending and $0 available. Read initially as a fundamental payment-architecture problem (funds stuck in Bakeri's own account instead of the baker's).

**Symptom:** No visible balance anywhere the baker looked in Stripe.

**Root cause:** Two separate things, confirmed by querying Stripe directly rather than assuming either side of the disagreement:
1. The architecture itself is correct and already fixed (2026-07-30 direct-charge migration) — a charge lands on the baker's own connected Stripe Express account instantly, confirmed live (`transfer_data: null`, real pending balance on the account). The actual gap: **Express accounts have a completely separate dashboard from a normal Stripe login**, reachable only via a one-time login link or a specific Express URL — a baker with no way to find that URL saw nothing, anywhere, and reasonably concluded the money had vanished. It hadn't; it was on a screen she couldn't reach.
2. Separately (found while verifying): Tilly's connected account had its payout schedule stuck on `manual` (would never auto-payout regardless of balance), while the other five bakers' accounts already correctly showed `daily`. Isolated to one account, not systemic.

**Fix:** New `get-baker-payout-summary` and `trigger-baker-payout` edge functions surface the connected account's real balance (available/pending), recent activity, and a **freshly-generated** Stripe login link (a stale bookmarked link after any account reset was part of the original confusion) directly in the app's Banking & Payments screen — no more depending on a baker finding the right Stripe URL on their own. Added a "Request Payout" button for the no-fee standard payout; instant payouts (which carry a Stripe fee needing its own consent UI) stay on Stripe's own hosted dashboard via the same login link. Reset Tilly's account schedule to `daily` to match the other five. Also fixed two spots of stale copy still describing the pre-migration platform-custody model ("transferred...after the 24-hour dispute window...paid out weekly") with accurate, schedule-agnostic wording pointing at the new balance section.

**Affected users:** Every baker, in the sense that none of them had any way to see their own balance in-app before this — Tilly's schedule fix was account-specific.

**Follow-up:** None open.

---

## 2026-08-07 — Rescheduling a pickup never notified the customer, with no trace anywhere

**Reported by:** Harvey, live — rescheduled a ready order's pickup time (Tilly Sugar Cookies test order) and the customer got no "time changed" email.

**Symptom:** No email sent, no error shown to the baker, and nothing in `notification_log` to explain why.

**Root cause:** Two gaps compounding into a fully silent failure. `send-guest-order-ready-email` had no top-level try/catch (unlike every other guest email function in this codebase), so an unexpected error inside it produced an unhandled 500 with no `notification_log` row written. Meanwhile `mark-order-ready-for-pickup`'s `fetch(...).catch(...)` only catches network-level failures — `fetch` never rejects on a non-2xx response — so that 500 looked identical to success from the caller's side. The failure vanished on both ends at once, leaving zero trace.

**Fix:** [send-guest-order-ready-email/index.ts](supabase/functions/send-guest-order-ready-email/index.ts) now wraps its whole body in try/catch and logs every failure. [mark-order-ready-for-pickup/index.ts](supabase/functions/mark-order-ready-for-pickup/index.ts) now checks the actual response status, retries once, and returns a `notified` flag; the baker's app now shows a warning when it comes back false ("you may want to reach out directly") — the pickup time itself still saves successfully either way. Also fixed the same missing `timeZone: 'UTC'` date-formatting bug (see the entry below) in the push-notification date string. Verified by re-invoking the email function directly against the real order — sends and logs correctly now.

**Affected users:** Just this one test reschedule (Harvey's own testing) — no real customer affected, but the underlying gap was live for every baker's reschedule since the pickup-window feature shipped hours earlier the same day.

**Follow-up:** None open.

---

## 2026-08-07 — Paying a balance invoice marked the order completed/fulfilled

**Reported by:** Harvey, live — paid the balance on a custom-quote order and it disappeared off the active Orders list, treated as if it had been picked up. No "Mark Ready" or "Mark Completed" step ever happened.

**Symptom:** Full payment (deposit + balance, or a one-shot full invoice) on a marketplace/quote-based order instantly set it to `completed`, skipping `ready_for_pickup` entirely — payment status and fulfillment status got conflated.

**Root cause:** `finalize-invoice-payment`'s non-deposit branch unconditionally set `marketplace_status: "completed", completed_at: paidAt` whenever the paid order's `order_source` was `'marketplace'` — which every quote-based custom order is, from creation. The baker's own "Mark Ready" → "Mark Completed" flow (confirmed elsewhere in the app) never got a chance to run.

**Fix:** [finalize-invoice-payment/index.ts](supabase/functions/finalize-invoice-payment/index.ts) now only ever *advances* `marketplace_status` to `confirmed` (a payment milestone, matching what `finalize-guest-quote-payment` already sets after a quote payment) — and only from a pre-payment status (`pending`/`pending_quote`/`quote_provided`/null). It never touches the status once the baker has already moved it further (`ready_for_pickup`/`completed`) or terminal (`cancelled`/`declined`). Fulfillment stays exclusively a manual baker action. Deployed live 2026-08-07.

**Affected users:** Two of Harvey's own test orders had already been wrongly auto-completed this way — both repaired back to `confirmed` (no real customer orders were affected; checked directly).

**Follow-up:** None open.

---

## 2026-08-07 — Invoice receipt/order-detail showed the listing's raw price next to a quoted item, with no deposit/balance record

**Reported by:** Harvey, live screenshots — the customer's post-payment receipt on `/pay/` showed "1× Custom Decorated Sugar Cookies — $42.00" directly above "Total — $0.75" (the real balance charged), reading like a math error. The baker's own order screen showed the same "$42.00" next to the item and only "Status: Paid in full" under Payment, with no record of when the $0.50 deposit vs. $0.75 balance were each paid.

**Root cause:** `order_items.price_per_unit` is the listing's original "from $X" price — once a baker quotes a flat total (`quoted_price`/`order.quotedPrice`) that overrides it, nothing ever stopped the UI from still displaying that stale per-unit price next to the item, right beside a Total that's the real (lower) quote. Separately, the "Paid in full" status line was a dead end — it never broke out the deposit and balance as the two separate payments (different amounts, different dates) they actually were.

**Fix:**
- Item rows now suppress the per-unit price whenever a quote overrides it — [pay/index.html](pay/index.html)'s receipt, and both item lists in [MarketplaceOrderSheet.swift](Bakerly/Bakerly/Bakeri/Views/Orders/MarketplaceOrderSheet.swift) (editable-items Total row and the completed-order Transaction Record).
- `create-invoice-payment-intent` now returns `quoted_price`, `deposit_amount_cents`, `deposit_paid_at` so the web receipt can reconstruct the whole transaction, not just the amount charged on that specific page load.
- The web receipt and the baker's app-side Payment card both now show Deposit and Balance as separate rows with their own amount and paid date when a deposit was involved, instead of collapsing to one "Total"/"Paid in full" line.
- Deployed: `create-invoice-payment-intent` edge function redeployed, `pay/index.html` pushed live; `MarketplaceOrderSheet.swift` committed and pushed to `Bakeri-app` (`1f9f671`) — ships with next app build.

**Affected users:** Cosmetic/reporting only — no charge was ever wrong, this was purely what the receipt/order screen displayed. Affects any baker/customer on a quoted-below-listing order with a deposit+balance split, which is exactly the flow from the incident above.

**Follow-up:** None open.

---

## 2026-08-07 — Claiming an invoice in-app overwrote the real quote; baker-cancelled orders misattributed the cancellation

**Reported by:** Harvey, live end-to-end test on Tilly Sugar Cookies — quoted a $42 listing down to $1.25 ($0.50 deposit / $0.75 balance) via a custom order form. The customer's quote email showed "Pay $1.25" with no deposit/balance breakdown even though only the $0.50 deposit was actually charged on click-through. After the deposit was paid, generating the $0.75 balance invoice worked and the email correctly said $0.75 — but the /pay/ payment page it linked to auto-triggered iOS's "Open in Bakeri" system prompt on load (before the page had even shown an amount), an accidental tap on it silently claimed the invoice in-app, and from then on the baker's own UI and every resent invoice showed $41.50/$144-range numbers instead of $0.75, with the web link now permanently "Already claimed" and no way to reissue. Separately, when the baker cancelled+refunded the order, the *baker* got a push saying "Mable has cancelled the custom cookie order" (backwards — the baker cancelled it) and the customer got no cancellation/refund notification at all.

**Root cause:** Five compounding bugs:
1. `pay/index.html` unconditionally fired `window.location.href = 'bakeri://invoice/...'` on every iPhone/iPad page load, before the visitor saw anything — that's what triggers iOS's "Open in Bakeri?" prompt, and an accidental tap claims the invoice with no real payment attempt.
2. `claim_invoice` (RPC) unconditionally set `quoted_price = SUM(order_items)` on claim — overwriting a real, already-set quote with the listing's raw "from $X" price the instant a buyer claimed the invoice in-app. Every downstream read (baker's Generate Invoice button, resent invoice emails, `get_invoice_preview`) then used the corrupted value.
3. `get_invoice_preview` and `pay-invoice-order` (the in-app counterpart to this morning's already-fixed `create-invoice-payment-intent`) both computed the amount from raw `order_items` only, with no `quoted_price` fallback at all — so even before the claim-corruption, the in-app preview/payment path never respected a lower quote. `pay-invoice-order` also added Bakeri's platform fee on top of the customer's payment, contradicting its own comment that it should match `create-invoice-payment-intent`'s baker-absorbs-the-fee policy.
4. `send-guest-quote-email` never selected `deposit_amount_cents` and always showed/linked the full quoted price ("Pay $X"), even when the baker split it into a deposit + balance — the actual charge on click-through (`baker/pay-quote.html`) was already correct, this was a display-only mismatch.
5. `trg_fn_marketplace_order_notify`'s `cancelled` branch always assumed the *buyer* cancelled (pushing the baker "{buyer} cancelled their order") regardless of who actually triggered the status change — so a baker-initiated cancel via `cancel-order` (a service-role update, `auth.uid()` NULL) misattributed the action to the buyer and never notified the buyer at all through the trigger; `cancel-order`'s own separate manual buyer-push existed but duplicated (rather than fixed) the trigger's logic.

**Fix:**
- [pay/index.html](pay/index.html) — removed the auto-fired deep link; only fires now from the explicit "Already have the Bakeri app? Open & pay there" button.
- `claim_invoice`/`get_invoice_preview` — [20260807000002_invoice_claim_respects_quoted_price.sql](supabase/migrations/20260807000002_invoice_claim_respects_quoted_price.sql): claim never overwrites an existing `quoted_price`; preview now matches `create-invoice-payment-intent`'s `effectiveTotal` + `invoice_type` (deposit/balance/full) math exactly.
- [pay-invoice-order/index.ts](supabase/functions/pay-invoice-order/index.ts) — added the same `quoted_price` fallback, and stopped adding the platform fee on top of the customer's payment.
- [send-guest-quote-email/index.ts](supabase/functions/send-guest-quote-email/index.ts) — shows a deposit/balance breakdown and labels the button "Pay Deposit $X" when the quote is split, matching `baker/pay-quote.html`.
- `trg_fn_marketplace_order_notify` — [20260807000003_fix_cancel_notification_attribution.sql](supabase/migrations/20260807000003_fix_cancel_notification_attribution.sql): branches on `auth.uid() = buyer_id` to tell a buyer-initiated cancel from a baker-initiated one and notifies/attributes correctly in each direction; removed [cancel-order](supabase/functions/cancel-order/index.ts)'s now-redundant manual buyer push.
- Data repair: reset the one corrupted live order's `quoted_price` back to `1.25` (Tilly Sugar Cookies, already cancelled and refunded before the fix — no customer was ever overcharged, since the balance was never actually collected). Audited all other in-app invoice claims system-wide; no other orders were affected. Deployed and pushed live 2026-08-07.

**Affected users:** Only the one test order above (Harvey's own end-to-end test, using a personal buyer account). No real customer's quote was corrupted or overcharged. The two general-purpose bugs (auto-open-in-app on any /pay/ visit, and every baker cancellation misattributing the notification) had been live and affecting all bakers/customers on the platform since those features shipped — fixed going forward for everyone, not just this one incident.

**Follow-up:** Harvey decided in-app invoice claim+pay isn't ready to be reachable at all right now, not just the accidental-open path — turned off entirely (decision 2026-08-07): `claim_invoice` and `pay-invoice-order` are gated server-side (both raise/return `feature_disabled`), and the app's two entry points (`BuyerOrdersView`'s manual "Enter Invoice #" button, the `bakeri://invoice/` deep link sheet in `BakeriApp.swift`) are hidden behind a new `MarketplaceAvailability.inAppInvoicePayEnabled = false` flag, matching the existing pattern used for other paused features. The web `/pay/` page's "Open & pay there" button (and its now-dead deep-link code) was removed too — `/pay/` is the only way to pay an invoice while this is off, and it's unaffected. Trivially reversible when the flow is hardened: flip the Swift flag, re-deploy `claim_invoice`'s real body (20260807000002) and undo the `pay-invoice-order` gate. Recommend a spot-check of a real deposit→balance custom-order flow end to end via `/pay/` before this reopens.

---

## 2026-08-07 — Baker-facing balance/revenue displays also ignored a lower quoted_price

**Reported by:** Harvey, asking for certainty that a quote below a listing's "from $X" price is honored everywhere, not just in the invoicing pipeline fixed earlier today (see the entry below this one).

**Symptom:** Not a live-reported bug — a proactive audit requested after today's balance-invoice incident, to check for the same failure class elsewhere: any screen that could show a baker "you're still owed $X" using the listing's original price instead of a lower amount actually quoted.

**Root cause:** The same `order.totalPrice` (raw `order_items` sum) vs `order.effectiveTotal` (prefers `quotedPrice` when set) mismatch, in five more places the earlier pass didn't touch — all baker-facing, none of them Stripe/payment code:
- `OrdersView.swift`'s `outstandingAmount` (the "Balance Owing" badge on every order row) and `OrderDetailView.swift`'s "Balance Due" line — both showed an inflated balance for a marketplace order quoted below its listing price.
- `IngredientCost.swift`'s `profit(using:)`/`marginPercent(using:)`, and every place reading from them or independently repeating the same `totalPrice - cost` math: `OrderDetailView`'s Financials card, `FinancialReportView`'s pending-revenue stat/revenue sort/CSV export/order-row list, `RevenueDetailView`'s pending revenue — all overstated revenue/profit on the same class of order.
- `OrderDetailView`'s percentage-based deposit calculator (the "Record Deposit → Percentage" entry mode) — computed a suggested deposit amount off the listing price instead of the actual quote (e.g. "50%" of a $41 listing instead of 50% of a $3 quote).

Verified clean (audited, no fallback-to-listing-price bug found): every Stripe-facing edge function (`create-invoice-payment-intent`, `finalize-invoice-payment`, `send-invoice-email`, `create-guest-quote-payment-intent`, `finalize-guest-quote-payment`, `charge-balance-payment`, `pay-quote-order`, `pay-invoice-order`), `Order.swift`'s other computed properties (`effectiveTotal`, `netPayoutEstimate`, `revenueReceived`, `formattedTotal`), `BuyerOrderModels.swift`'s buyer-facing `effectiveSubtotal`/`grandTotal`/`formattedTotal`, `MarketplaceOrderSheet.swift`'s quote form (no minimum-price validation blocks a low quote), and every SQL migration (`quoted_price` is an unconstrained `NUMERIC(10,2)` — no CHECK constraint or trigger enforces a floor against the listing price). Nowhere does anything do a `max(quotedPrice, listingPrice)`-style clamp.

**Fix:** All six call sites changed from `order.totalPrice` to `order.effectiveTotal` (or the local `profit`/`revenue` var recomputed the same way) — [OrdersView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/OrdersView.swift), [OrderDetailView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/OrderDetailView.swift), [IngredientCost.swift](Bakerly/Bakerly/Bakeri/Models/IngredientCost.swift), [FinancialReportView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/FinancialReportView.swift), [RevenueDetailView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/RevenueDetailView.swift). Committed and pushed (`Bakeri-app` `f826d54`); ships with the next app build.

**Affected users:** Any baker with a marketplace order quoted below its listing's "from" price — cosmetic/reporting only (no money was ever mischarged by these specific spots; the actual Stripe charges go through the pipeline fixed in the entry below), but directly misleading about how much is still owed or how profitable an order was.

**Follow-up:** None open. Not yet verified in a running build — recommend spot-checking the Orders list badge and a Financial Report export against a real quoted-below-listing order once the next build ships.

---

## 2026-08-07 — Balance invoice on a guest quote billed the listing's "from" price, added Bakeri's fee on top, and used an outdated payment page

**Reported by:** Harvey, live — quoted a guest $3 ($1 deposit + $2 balance) via a custom order. After the guest paid the $1 deposit, the baker went to invoice the $2 balance; the app showed "Generate Balance Invoice — $40.00" (the listing's real per-unit "from" price minus the deposit, not the quoted price). The baker sent it anyway; the customer got an unexpected large payment request, styled inconsistently with the app's other emails, and clicking it landed on an old payment page (`/pay/`) that added Bakeri's service charge on top of the amount instead of absorbing it baker-side. Transaction couldn't complete.

**Root cause:** Three separate but compounding bugs, all variants of the same theme — a legacy invoice pipeline predating `quoted_price` was never taught about it:

1. **App never learns its own quote.** `MarketplaceOrderSheet.swift`'s `submitQuote()` PATCHes `quoted_price`/`deposit_amount_cents` straight to Supabase but never set the equivalent `order.quotedPrice`/`order.depositAmountCents` locally — then called `order.touch()`, bumping the local `updatedAt` *past* the timestamp it had just written server-side. `SyncService.pullOrders`'s merge is last-write-wins on `updatedAt` (`if row.updatedAt > local.updatedAt`), so the correct quote coming back down from the server was silently discarded as "older" than the stale local copy — the app kept computing the balance off `order.totalPrice` (the listing's original per-unit price from `order_items`) instead of the actual quote.
2. **Invoice generation corrupted the deposit record.** `InvoiceSectionView.swift`'s `generateUniqueInvoiceCode()` wrote whatever dollar amount was on-screen into `deposit_amount_cents` for *every* invoice type, including `.balance` — but for a marketplace/guest-quote order that column already held the real deposit amount ($1), which `create-invoice-payment-intent` depends on to compute the balance. Generating a balance invoice clobbered it with the (already-wrong) displayed remaining figure.
3. **Legacy invoice-code pipeline ignored `quoted_price` and used the old fee model.** `create-invoice-payment-intent`, `finalize-invoice-payment`, and `send-invoice-email` all computed the invoice amount purely from `order_items` (the listing price), with no awareness that a marketplace order might have a `quoted_price` overriding it — and `create-invoice-payment-intent` added Bakeri's 5% fee on top of the customer's charge, which was the policy prior to the 2026-08-02 guest-absorbs-fee change (see `_shared/fees.ts`) but never got updated here. Since this `/pay/` invoice-code page is guest-only by construction (`buyer_profile_id` must be null), it should always follow the guest/baker-absorbs model like `create-guest-quote-payment-intent` and `charge-balance-payment` already do.

**Fix:**
- [MarketplaceOrderSheet.swift](Bakerly/Bakerly/Bakeri/Views/Orders/MarketplaceOrderSheet.swift) — `submitQuote()` now sets `order.quotedPrice`/`order.depositAmountCents`/`order.paymentFlowRaw` locally in the same block, before `touch()`; `retractQuote()` clears `order.quotedPrice` locally to match. Removes the sync race entirely — no reliance on a subsequent pull to see your own quote.
- [InvoiceSectionView.swift](Bakerly/Bakerly/Bakeri/Views/Orders/InvoiceSectionView.swift) — `generateUniqueInvoiceCode()` only writes `deposit_amount_cents` for `.deposit`-type invoices now; `.balance`/`.full` pass `nil` (synthesized `Encodable` omits it from the PATCH body via `encodeIfPresent`), leaving the real deposit amount untouched.
- [create-invoice-payment-intent/index.ts](supabase/functions/create-invoice-payment-intent/index.ts) — added `quoted_price` to the order select; base amount now falls back to `quoted_price` over `order_items` total (matching `Order.swift`'s `effectiveTotal`); dropped the on-top fee addition — `amount = baseAmountCents`, fee taken only via `application_fee_amount` from the baker's side.
- [finalize-invoice-payment/index.ts](supabase/functions/finalize-invoice-payment/index.ts) — same `quoted_price` fallback when recomputing the base amount, so the recorded `platform_fee_cents`/payout settlement matches what was actually charged.
- [send-invoice-email/index.ts](supabase/functions/send-invoice-email/index.ts) — same `quoted_price` fallback so the emailed amount matches the real quote, not the listing price.
- [pay/index.html](pay/index.html) — removed the "Includes $X Bakeri service charge" note (fee is no longer part of what the customer is shown/charged), matching `baker/pay-quote.html`.
- All three edge functions deployed live via `supabase functions deploy`. The Swift changes ship with the next app build.

**Affected users:** At minimum the one order Harvey hit live (guest quoted $3, $1 deposit paid, $2 balance never successfully invoiced — no balance charge was actually completed, so no refund needed). Any baker who quoted a guest a price different from a listing's "from" price and later sent a deposit or balance invoice through the app (rather than the newer `baker/pay-quote.html` full-quote flow) would have hit the same wrong-amount/wrong-fee bug — no way to enumerate from data alone without a full data audit; flag if more reports come in.

**Follow-up:** Two items noted but not fixed in this pass: (1) the balance-invoice email's visual template reads close to but not identical to the app's other confirmation emails — cosmetic, lower priority, worth a follow-up template consistency pass; (2) not yet verified end-to-end with a real guest payment against the fixed pipeline — recommend a live test (quote → deposit → balance invoice → guest pays) before assuming fully closed. Swift changes not yet committed/built.

**Follow-up (2026-08-07, same day):** Item (1) fixed — see the next entry below, which restyles both `pay/index.html` and the invoice email to match `baker/pay-quote.html`/`send-guest-quote-email`. Item (2) still open — no live end-to-end test run yet. Swift changes have since been committed and pushed (`Bakeri-app` `94f322c`); still need a real app build to reach bakers.

---

## 2026-08-07 — Instagram's in-app browser resumed a stale page instead of reloading; balance invoice looked like a different product than the quote

**Reported by:** Harvey. Two related reports: (1) tapping a baker's Instagram bio link, browsing into `baker/custom-order.html`, closing the in-app browser, then tapping the same bio link again landed back on the custom-order form exactly as left, instead of a fresh storefront load. (2) Screenshots of a real deposit→balance invoice flow: the quote email and `baker/pay-quote.html` looked clean and on-brand, but the balance invoice (both the page at `/pay/` and its email) looked like a completely different, older product — different fonts, colors, layout.

**Root cause:**
1. **Bfcache, not Instagram caching stale content from the network.** In-app browsers (Instagram's especially) can keep a WebView "tab" alive across a visible close/reopen of the same link instead of tearing it down. Reopening the link then resumes the exact page via the browser's normal back/forward cache (bfcache) — same DOM, same JS state, same scroll/form position — rather than issuing a fresh navigation. Nothing server-side was stale; the page itself never got a chance to reload.
2. **Two unrelated visual templates for what's really one flow.** `pay/index.html` (serif Playfair Display type, floating card, black "Open in app"/green "Pay" buttons, full receipt/print view) and the invoice email template (pink hero banner, teal CTA, dark footer — copy-pasted from `send-vendor-ack-email`, an unrelated vendor-facing template) both predate `baker/pay-quote.html`/`send-guest-quote-email` and were never brought in line with them. A guest who gets a deposit invoice then a balance invoice — or a quote then an invoice — was effectively seeing two different apps mid-transaction.

**Fix:**
- Added a `pageshow` listener (`if (event.persisted) window.location.reload()`) to [baker/theme.js](baker/theme.js) — shared by `baker/index.html`, `custom-order.html`, `checkout.html`, `digital-checkout.html` — plus directly in [baker/pay-quote.html](baker/pay-quote.html) and [pay/index.html](pay/index.html), which don't load `theme.js`. `event.persisted === true` is the standard signal a page came from bfcache rather than the network; forcing a reload there means every reopened link lands on a clean, current page.
- [pay/index.html](pay/index.html) rewritten to match `baker/pay-quote.html`'s design system exactly: same CSS variables, same storefront header/logo/hero-photo block (linking back to the baker's storefront), same typography and black pill buttons. Kept its invoice-specific features (deposit/balance/full labeling, "Open & pay in the Bakeri app" deep link, itemized receipt after payment) but restyled them with the shared tokens instead of the old serif/green-button system.
- [create-invoice-payment-intent/index.ts](supabase/functions/create-invoice-payment-intent/index.ts) now also returns `profile_slug` (added to the `profiles` select) so the restyled page can link back to the storefront the same way `pay-quote.html` does.
- [send-invoice-email/template.ts](supabase/functions/send-invoice-email/template.ts) rewritten to mirror `send-guest-quote-email`'s inline HTML (plain white background, tan "For" info box, black pill button, "copy this link" fallback) instead of the old vendor-style template. [send-invoice-email/index.ts](supabase/functions/send-invoice-email/index.ts) updated to feed it a standalone greeting line and an invoice-type-aware heading ("Your deposit is due" / "Your balance is due" / "Your invoice is ready"), matching the quote email's tone.
- Both edge functions deployed live; web changes pushed (GH Pages).

**Affected users:** All guests — the bfcache issue affects any storefront visitor on Instagram (or similar in-app browsers) who navigates within the site and reopens the same bio link later. The styling mismatch affects every deposit/balance/full invoice sent through the app's "Generate Invoice" flow (not the newer full-quote-only `pay-quote.html` path, which was already consistent).

**Follow-up:** Not verified against a real Instagram in-app browser session (couldn't reproduce the bfcache resume locally) — worth Harvey confirming on-device once this ships. `pay/index.html`'s new header photo/logo block depends on `create-invoice-payment-intent` returning a real `baker_id`/`profile_slug` — fine for the common case but hasn't been checked against a baker with no logo/header image uploaded (should fall back to the initial-letter avatar, same as `pay-quote.html`, but not manually confirmed).

---

## 2026-08-07 — Guest quote checkout charged the full order instead of the deposit

**Reported by:** Harvey, live — Tilly Sugar Cookies' "Custom Decorated Sugar Cookies" order ($42, quoted as $2 deposit + $40 balance) charged the customer the full $42 immediately, and Tilly's app kept showing the payment as pending/unclear even though it had gone through.

**Symptom:** A baker quotes a custom order to a guest (no Bakeri account) via the public website with a deposit + balance split. The guest pays through `baker/pay-quote.html`. Two things went wrong: (1) the guest's card was charged the full order total, not just the deposit; (2) the baker's order screen showed a "Payment Held" badge and a "Balance — Captured at pickup confirmation" line, both of which read as "not fully paid yet" even though the full amount had, in fact, already been captured.

**Root cause:**
- [create-guest-quote-payment-intent/index.ts](supabase/functions/create-guest-quote-payment-intent/index.ts) had an explicit, documented "scope decision" to always charge the full `quoted_price` regardless of any deposit/balance split the baker configured — because a one-off guest checkout has no saved card to charge the balance against later. Correct reasoning, wrong tradeoff: it silently overrode whatever the baker had actually quoted.
- [finalize-guest-quote-payment/index.ts](supabase/functions/finalize-guest-quote-payment/index.ts) unconditionally set `payment_status: "authorized"` after any successful charge, regardless of whether the full amount or just a deposit had been captured. The app's own badge logic treats `"authorized"` as "Payment Held" (implies pending/not yet captured) — so even a fully-captured full payment displayed as if it were still awaiting capture.

**Fix:**
- `create-guest-quote-payment-intent` now charges only the deposit when the order has a genuine partial deposit set (via the order's `deposit_amount_cents`), tagging the PaymentIntent's metadata with `leg: "deposit" | "full"`. Full-price orders are unaffected. Deployed.
- `finalize-guest-quote-payment` branches on that same `leg` metadata: a deposit charge sets `payment_status: "deposit_paid"` (leaves `is_paid` false, records `deposit_paid_at`/`deposit_payment_intent_id`/settlement fields, mirroring the existing invoice deposit flow); a full charge sets `payment_status: "captured"` and `is_paid: true`. Deployed.
- `baker/pay-quote.html` now tells the guest up front when they're only paying a deposit, and that the baker will follow up separately for the balance, instead of silently showing a smaller charge amount than the quote total with no explanation.
- `MarketplaceOrderSheet.swift` (baker app): status badge now shows "Paid in Full" once `payment_status == "captured"` instead of a generic "Confirmed"; the deposit/balance breakdown no longer claims a guest-quote balance is "Captured at pickup confirmation" (there's no saved card to auto-capture from for a guest order) — it now says the baker needs to send a payment link to collect it.
- Balance collection for a guest-quote deposit order is a manual follow-up (baker sends a second payment link via the existing invoice-code "balance" flow) — there's no automatic off-session charge for guest orders, unlike the in-app cart's deposit_and_save flow.

**Affected users:** At minimum the one confirmed order (Tilly Sugar Cookies, order `9c8de489-4e05-46a8-8f1b-cb024953c881`, $42.00, live-mode charge `pi_3U1bblRyVzjyR7Rh04xXgoAY`) — any baker who'd quoted a guest with a deposit split before today would have hit the same overcharge. Refund for the $42 order was not executed by me (I don't execute financial transfers) — walked Harvey through doing it himself via the app's existing baker-initiated cancel/refund action.

**Follow-up:** No retroactive DB correction applied to the affected order beyond what the refund/cancel flow itself sets — once refunded, `cancel-order` overwrites its `payment_status` to `"refunded"`, which supersedes the stale "authorized" label. Worth a sweep later for any *other* pre-existing guest-quote deposit orders placed before this fix that may have the same full-charge/deposit-split mismatch.

---

## 2026-08-06 — Ingredient picker showing duplicate entries (e.g. "Brown Sugar" x3)

**Reported by:** Harvey, via screenshot — typing "Sugar" in the recipe ingredient picker showed "Brown Sugar" three times in a row before "Coconut Sugar". Also flagged: common ingredients like "Flour" and "Granulated (white) Sugar" are hard to find in the dropdown.

**Symptom:** The ingredient autocomplete dropdown (New/Edit Recipe → ingredient row) lists the same built-in ingredient multiple times.

**Root cause:** `SwiftDataRepository.seedIngredientDensitiesIfNeeded()` re-seeds the built-in `IngredientDensity` list whenever `IngredientDensity.seedVersion` is bumped (5 times to date). It did this by deleting every built-in row locally and reinserting the full list with brand-new random UUIDs — but the delete was a plain local `modelContext.delete`, never a soft-delete, so no tombstone was ever sent to Supabase. The old-generation rows survived server-side and came back down on the next sync pull as "new" records (pull matches by `id` only), permanently duplicating every built-in ingredient once per reseed generation the user had synced through. These weren't display duplicates — they were genuinely distinct `IngredientDensity` records with the same name.

**Fix:**
- `SwiftDataRepository.seedIngredientDensitiesIfNeeded()` — [SwiftDataRepository.swift:156](Bakerly/Bakerly/Bakerly/Bakeri/Repository/SwiftDataRepository.swift:156) rewritten to merge by name instead of delete-all/reinsert: matched entries are updated in place (id stays stable, so reseeding can no longer fork), and any already-existing duplicates or genuinely removed ingredients are properly soft-deleted via `SyncService.softDelete` so the tombstone propagates. `IngredientDensity.seedVersion` bumped to 6 to trigger this cleanup once for every existing install.
- `AddEditRecipeView.swift`'s `IngredientFormRow` — added a display-level de-dupe (`dedupedByName`) as a second line of defense regardless of stored-data state.
- Added `IngredientDensity.commonPriority` — a ranked list of ~18 baking staples (All-Purpose Flour, Granulated Sugar, Brown Sugar, Butter, Egg, Milk, Baking Powder/Soda, Salt, Vanilla Extract, etc.) that now sort first both when browsing the full list and as a tiebreaker among equally-relevant search matches, so the common one isn't buried among 15–20 similarly-scored variants (e.g. every "___ Flour" entry previously tied for relevance on the query "flour").

**Affected users:** Any baker who had synced through more than one seed-data update — duplicate count scales with how many reseed generations they'd been through (up to 3x for built-ins seeded since v3, matching the screenshot). Cosmetic/annoyance only in the picker; `RecipeIngredient` stores its own copied `gramsPerCup` value rather than a live reference to a specific `IngredientDensity` row, so no recipe data was corrupted by the duplicates or by deleting them.

**Follow-up:** Not yet deployed to a build. No open issues — verified via clean build + cold launch (seeding runs unconditionally at every app launch); could not click through the live dropdown in this pass since it's behind sign-in and no test credentials were available here.

---

## 2026-08-06 — Inspiration photo picker glitched/reset scroll position while browsing

**Reported by:** Baker (via Harvey) — "trying to attach inspo photos on an order and it is not letting me scroll through my photos, the app keeps glitching and jumping back to the beginning of my photos."

**Symptom:** Opening "Add Inspiration Photos" on an order and scrolling through the system photo picker to multi-select images caused the picker to glitch and reset back to the top repeatedly.

**Root cause:** `PhotosPicker`'s `selection` binding updates live as the baker taps each photo inside the system picker — it doesn't wait for the picker to close. [AddEditOrderView.swift](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/AddEditOrderView.swift)'s `onChange(of: selectedPhotoItems)` handler reset that binding to `[]` after processing each fire, while the picker was often still open. That external reset fought the picker's own selection state, forcing it to resync/re-layout mid-browse — which is what showed up as glitching and the scroll position jumping back to the start. It also meant every additional tap re-processed (re-downloaded, re-decoded, re-compressed) every previously-picked photo all over again, since `newItems` is the full current selection, not just the delta.

**Fix:** Stopped clearing `selectedPhotoItems` from inside the handler. Added `loadedPhotoItemIDs: Set<String>` keyed on each item's `itemIdentifier` so already-loaded photos are skipped on subsequent fires instead of reprocessed, without ever mutating the picker's own binding mid-session.

Also addressed two feature requests that came in alongside the bug report: (1) ability to attach files from the Files app, not just Photos — added a "Add File (PDF)" button using `.fileImporter`, restricted to `.pdf` and capped at 15 MB (rejects oversized files with an alert) since the request was specifically for things like a production map/spec sheet, not arbitrary file types; (2) uploaded PDFs are now viewable from the order detail screen via QuickLook. New `Order.referenceDocuments`/`referenceDocumentNames` fields (SwiftData, `.externalStorage`) store them alongside the existing `referencePhotos`.

**Affected users:** Any baker attaching more than a couple of inspiration photos to an order — cosmetic/UX only, no data loss (photos that did load were saved correctly, just painfully).

**Follow-up:** The new PDF/document fields are local-device storage only — unlike `referencePhotos`, they are **not** wired into `SyncService`'s Supabase push/pull, so a production-map PDF attached on one device won't show up on another, and won't survive a reinstall. Extending that would mean new Supabase Storage handling + schema columns, out of scope for this pass — flag to Harvey if cross-device sync turns out to matter in practice. Not yet deployed to a build.

---

## 2026-08-06 — Dark mode text washed out on Orders cards and tab bar

**Reported by:** Baker (via Harvey) — Orders screen text "pretty well completely washed out" in dark mode; follow-up report the tab bar was washed out too.

**Symptom:** In dark mode, order card text was nearly invisible, and the bottom tab bar icons/labels (especially the selected tab) were hard to see.

**Root cause:** Two separate hardcoded-color bugs, same root pattern (light-mode-only color used somewhere that's supposed to be dark-mode-adaptive):
1. `OrdersView.swift`'s order card wrapper hardcoded `.background(Color.white)` while the row content correctly used `Color.primary`/`Color.secondary` for text — in dark mode `Color.primary` renders white, so it was white text on a white (hardcoded) card.
2. `AppTheme.swift`'s `applyAppearance()` hardcoded the tab bar's selected-icon/title color and overall tint to `UIColor.black`, which doesn't flip in dark mode — invisible against the dark tab bar background.

**Fix:** [OrdersView.swift:361](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/OrdersView.swift:361) — card background changed to `Color(.secondarySystemBackground)` (same pattern as `BakeriCardModifier`). [AppTheme.swift:165,171,177](Bakerly/Bakerly/Bakerly/Bakeri/Models/AppTheme.swift:165) — selected tab color/tint changed from `UIColor.black` to `UIColor.label` (auto-adapts).

Followed up with a full sweep of the ~80 other hardcoded `.background(Color.white)` call sites in the codebase. Found the app actually has two legitimate, separate color systems: the baker-tool surfaces (Schedule/Orders/Recipes/Calculator) use adaptive `Color.primary`/`Color.secondary` and are meant to flip with dark mode; the Marketplace/Community/storefront-facing surfaces intentionally use a fixed "Market"/"Profile" palette (`bakeriMarket*`/`bakeriProfile*`, documented in `BakeriTheme.swift` as "static, always") so the in-app buyer experience always matches the public web storefront regardless of the baker's chosen theme. The bug was only ever adaptive text landing on a hardcoded-white background (or, in two cases, fixed-dark text landing on an *adaptive* background) — not the fixed Market palette itself, which is working as designed.

Fixed 9 more genuine instances of the same root-cause pattern:
- [ScheduleView.swift:505,534,587,619](Bakerly/Bakerly/Bakerly/Bakeri/Views/Schedule/ScheduleView.swift:505), [FullRecipeCalculatorView.swift:235,318,374,405](Bakerly/Bakerly/Bakerly/Bakeri/Views/Calculator/FullRecipeCalculatorView.swift:235), [QuickConverterView.swift:222,363,409](Bakerly/Bakerly/Bakerly/Bakeri/Views/Calculator/QuickConverterView.swift:222), [CompletedOrdersView.swift:35](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/CompletedOrdersView.swift:35), [RecipesView.swift:569](Bakerly/Bakerly/Bakerly/Bakeri/Views/Recipes/RecipesView.swift:569), [OrderDetailView.swift:164,1055](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/OrderDetailView.swift:164) — same fix, `Color.white` → `Color(.secondarySystemBackground)`.
- [OrderStatusView.swift:1513,1529](Bakerly/Bakerly/Bakerly/Bakeri/Views/Marketplace/OrderStatusView.swift:1513) (buyer's post-checkout "Transaction Complete" receipt, which — unlike the rest of Marketplace — uses adaptive text) — same fix.
- [OrderMessageThread.swift:262](Bakerly/Bakerly/Bakerly/Bakeri/Views/Marketplace/OrderMessageThread.swift:262) — inverse of the same bug: the other-party chat bubble used fixed dark ink text (`bakeriMarketInk`) on an *adaptive* `Color(.tertiarySystemGroupedBackground)`, so it went dark-on-dark in dark mode. Changed the bubble background to the fixed `bakeriMarketCreamHi` token to match the rest of the Market palette.
- [MarketplaceOrderSheet.swift:279](Bakerly/Bakerly/Bakerly/Bakeri/Views/Orders/MarketplaceOrderSheet.swift:279) — the Messages-card expand/collapse chevron used adaptive `Color.secondary` on a fixed-white card; changed to the fixed `bakeriMarketMuted` token.

Left the remaining ~65 `Color.white` sites alone (Marketplace/Community/storefront views, `MenuPDFView.swift`'s PDF export, `OrderQRCodeView.swift`'s QR contrast, `MainTabView.swift`'s timer-alarm badge, `ProfileView.swift`'s notification badges) — each pairs a hardcoded background with hardcoded (not adaptive) foreground colors, so they render identically regardless of system theme by design.

**Affected users:** Any baker using dark mode / Dark Luxe theme; cosmetic only, no data impact. Not yet deployed to a build.

**Follow-up (2026-08-06, same day):** Baker found more washed-out text after the above fix: the Menu tab's "MENU ITEMS"/"FULFILLMENT" headers, the Orders tab's "In Progress" selector, and — once flagged — the baker realized this needed a systematic pass rather than one-off fixes ("we need to sus out the other screens that don't change").

This corrected the "two legitimate color systems" theory above: it's not baker-tools-vs-Marketplace-folder, it's **buyer-facing content vs. baker's own management chrome**, regardless of which folder the file lives in. Several baker-facing screens (Menu tab, Edit Listing, the order-management sheet, Recipes toolbar, and various Marketplace settings/onboarding sheets) were built with the fixed Market palette — presumably copy-pasted from buyer-facing storefront code — when they should have used the adaptive baker-tool palette like the rest of Baker Studio. `BakerMarketplaceView.swift` even has a code comment from a previous pass confirming this: one component there was deliberately made theme-adaptive "unlike the rest of this file's static... palette... this is the baker's own management view, not the shared customer-facing storefront." The rest of each of these files just never got the same treatment.

Converted the following baker-facing screens from the fixed `bakeriMarketInk`/`bakeriMarketMuted`/`bakeriMarketCream`/`Color.white` tokens to adaptive `Color.primary`/`Color.secondary`/`Color(.secondarySystemBackground)`/`Color(.systemGroupedBackground)`, keeping only genuine customer-preview elements (e.g. Edit Listing's "How customers see it" mock card, storefront-matching status badge colors) on the fixed palette since those must look identical regardless of the baker's theme:
- `BakerMarketplaceView.swift` (Menu tab) — headers, fulfillment card, view toggle, item cards/rows (now match Recipes cards), intro sheet
- `AddEditMenuItemView.swift` (Edit Listing) — page background, all section headers/cards, the Ready now/Pre-order/Custom/Digital selector, toggles, delete button
- `OrdersView.swift` — tab selector ("In Progress" etc.), sort button, add-order icon
- `OrderDetailView.swift` — invoice label
- `MarketplaceOrderSheet.swift` — the whole baker order-management sheet
- `RecipesView.swift` — grid/list toggle, toolbar icons
- `WebShopSheet.swift`, `DeliveryGate.swift`, `DepositGate.swift`, `MarketplaceOnboardingGate.swift`, `CreatePreOrderBatchSheet.swift`, `IntakeFormBuilderView.swift`, `PreOrderBatchDetailView.swift`, `IntakeFormsLibraryView.swift` — full conversions, no buyer-facing content in any of these
- `ShopView.swift` — one stray tile (`BakeriesTile`) that already had an adaptive background but fixed text; unrelated to the rest of that (correctly buyer-facing, correctly fixed-palette) file

Left alone: everything actually shown to buyers/guests (Shop, Cart, Checkout, Item Detail, buyer Order Status/Orders, intake forms buyers fill out, the public baker profile) — those are still meant to look identical regardless of the baker's dark mode setting, matching the public web storefront.

**Follow-up:** None open. Not yet deployed to a build — recommend a full click-through of Menu, Edit Listing, Orders, and Recipes in dark mode before shipping, since this was a large batch of file-wide edits that couldn't be visually verified from here.

---

## 2026-08-05/06 — Stripe Connect country always defaulted to Canada

**Reported by:** Baker (via Harvey) — "Stripe onboarding keeps auto-selecting Canada" despite picking United States in the app.

**Symptom:** Bakers picking "United States" during Stripe Connect onboarding still landed on Stripe's Canadian onboarding flow.

**Root cause:** Two separate bugs, found sequentially:
1. `create-connect-account-link` hardcoded `country: "CA"` on every new Stripe Express account — no baker input existed at all. Fixed by adding a `BakerCountry` picker (US/CA) to the app and threading the choice through to account creation, backed by a new `profiles.country` column and a `_shared/currency.ts` helper used to pick `usd`/`cad` for every payment-intent-creating function.
2. After that fix shipped, a second bug: `create-connect-account-link` parsed the request body as `const { data: body } = await req.json()...` — but `req.json()` *is* the body, there's no `.data` wrapper, so `body` was always `undefined` and the country selection was silently discarded on every request, defaulting back to `"CA"` regardless of what was picked. This bug pre-dated the country feature (same pattern already existed for `returnUrl`/`refreshUrl`) but was invisible until `country`'s fallback (`"CA"`) stopped matching intent.

**Fix:** `supabase/functions/create-connect-account-link/index.ts` — parse `req.json()` directly. Deployed 2026-08-06. Also added a "Start over" self-serve disconnect option to `BankingPaymentsView.swift`, `MarketplaceOnboardingGate.swift`, and `BakerPayoutSetupView.swift` for bakers who get stuck on an incomplete Stripe account with no way to restart (client-side only — ships with next app build, not yet live as of this entry).

**Affected users:** 8 bakers had a Stripe Express account silently created/forced to `CA` while bug #2 was live: Sugar'd Notes Cookie Co, Simply Sweet Cupcakes, Grateful Grain Sourdough Bakery, Taylor'd Cookies, The Sunday Bakehouse, Sweetsbysoph, Sarahs treats, Betty's Cookies. All 8 had `stripe_connect_account_id` cleared server-side (mirrors what the app's own "Disconnect Stripe" does — Stripe-side account left alone, nothing to clean up there) so their next "Connect with Stripe" creates a genuinely fresh account. Sugar'd Notes and Sweetsbysoph confirmed working after retrying. Outreach list (name/business/email) given to Harvey for the remaining 6.

**Follow-up:** "Start over" UI fix ships with the next app build. No open server-side issues.

---

## 2026-08-05/06 — Manual order silently converted to marketplace order when its invoice was paid

**Reported by:** Baker (via Harvey) — made a manual order, issued an invoice, and once paid the order itself changed into what looked like a marketplace order.

**Symptom:** A manual order's type/workflow changed after invoice payment — baker lost the manual order-status tracker (Confirmed/Baked/Decorated/Packaged/Delivered) in favor of marketplace order UI.

**Root cause:** Three compounding issues:
1. `finalize-invoice-payment` unconditionally set `marketplace_status: "completed"` on every paid invoice, including plain manual orders — violating the schema's own "NULL for manual orders" constraint and triggering UI that reads that field to route/list orders as marketplace.
2. The deeper cause: `claim_invoice`/`claim_and_pay_invoice` (RPCs run when a buyer claims + pays an invoice in-app) explicitly set `order_source = 'marketplace'` on what was created as a manual order. Per product rule, **`order_source` is fixed at creation and must never change** — manual stays manual, web stays web, marketplace stays marketplace, permanently.
3. Separately discovered while fixing this: `claim_and_pay_invoice` never actually called Stripe — it marked orders `is_paid = true` directly in the database ("still TEST MODE" per its own original migration comment). Live in production, meaning any real buyer using in-app "claim and pay invoice" was marked paid without being charged.

**Fix:**
- `finalize-invoice-payment` only touches `marketplace_status`/`completed_at` when the order's `order_source` is genuinely `'marketplace'` (not inferred from `buyer_profile_id`).
- `claim_invoice`/`claim_and_pay_invoice` no longer touch `order_source` at all (`20260805000003_order_source_immutable.sql`); a backfill migration reverted the 2 orders already corrupted by it.
- `claim_and_pay_invoice` dropped entirely (`20260805000004_drop_mock_claim_and_pay_invoice.sql`) and replaced with a real Stripe Connect direct-charge flow: new edge function `pay-invoice-order` + real `PaymentSheet` in `EnterInvoiceCodeView.swift`, mirroring the existing `pay-quote-order`/`OrderStatusView` pattern. Requires the next app build to take effect (server side is live now; the in-app claim/pay button won't work again until the build ships, since it was calling an RPC that no longer exists).
- Buyer-side visibility bug found in the same pass: `BuyerOrdersView.swift` and its RLS policies filtered on `order_source = 'marketplace'`, so a buyer who claimed+paid a manual order's invoice never saw it in their own Orders tab. Widened to `buyer_profile_id = auth.uid()` alone (`20260805000005_buyer_read_claimed_manual_orders.sql`) — that column is only ever set on an order the buyer legitimately owns.

**Affected users:** No specific baker list — this was corrupting data going forward for any manual+invoice order a buyer claimed in-app, and faking payment for any such order paid in-app. Two known corrupted orders repaired via backfill.

**Follow-up:** The real-charge "claim and pay invoice" flow needs a live end-to-end test with a real card once the next build ships — could only be verified up through PaymentSheet presentation during development (the app ships with a live, not test, Stripe key).

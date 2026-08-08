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

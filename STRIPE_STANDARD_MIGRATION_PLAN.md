# Migration plan: Stripe Connect **Express → Standard**

Written 2026-09-01. **Decisions locked:**

- **Full Standard, no hybrid.** Every baker moves to a Standard connected account.
- **Tap to Pay rollout paused** and revisited as a separate project later
  (Stripe Terminal for Connect needs Express/Custom). `TapToPayAvailability
  .tapToPayEnabled` is already `false`, so nothing user-facing changes.
- **Old Express accounts:** all are zeroed except one (Cookiesbysteph). Close the
  zeroed ones immediately; pay out the one and close it later.
- **Cutover-safety hardening** (per-order account-id snapshot) is **deferred** —
  the cutover reset disables every storefront's checkout for the whole reconnect
  window, so no new order can be created against a mismatched account. Still
  worth doing for the general "Start over" button; not a blocker here.
- **Baker comms:** email via `send-connect-migration-email` + the built-in
  `check-stripe-connect-health` "Payments Paused" push.

## Why

Express bills the **platform** ~CA$2/mo per active account + 0.25% volume +
per-payout fees (≈$15.75 CAD in Aug against ~$20–25 of application-fee revenue),
and leaves the platform as the negative-balance backstop for every baker.
Express fit the pre-2026-07-30 platform-custody model; the direct-charge
migration removed custody but never revisited the account type. On **Standard** +
direct charges the platform pays Stripe **~$0** in Connect fees, keeps its
`application_fee_amount` cut unchanged, and sheds dispute/loss liability to the
baker, who also owns their own dashboard and payout schedule.

## Status

### Done — code (not deployed)

| Change | File(s) |
|---|---|
| Migration: `profiles.stripe_connect_account_type` (`express`\|`standard`; existing → `express`, new default `standard`) | [supabase/migrations/20260901000001_stripe_standard_accounts.sql](supabase/migrations/20260901000001_stripe_standard_accounts.sql) |
| Create `type: "standard"`; drop `capabilities` + `settings.payouts.schedule`; persist `stripe_connect_account_type` | [create-connect-account-link/index.ts](supabase/functions/create-connect-account-link/index.ts) |
| Drop Express-only `createLoginLink`; `Promise.allSettled` reads; **no** `listExternalAccounts` (blocked for Standard); `has_bank_account`/`has_debit_card` hardcoded `true` for shipped-build shape stability; `dashboard_login_url` → `dashboard.stripe.com/balance` | [get-baker-payout-summary/index.ts](supabase/functions/get-baker-payout-summary/index.ts) |
| `trigger-baker-payout` **deleted** (function dir) | — |
| Add classic `account.updated` handler alongside V2 thin path; dual signing-secret (`STRIPE_CONNECT_WEBHOOK_SECRET` + `_CLASSIC`) | [stripe-connect-webhook/index.ts](supabase/functions/stripe-connect-webhook/index.ts) |
| One-off baker broadcast; dry-run by default; `{send:true}` to send | [send-connect-migration-email/index.ts](supabase/functions/send-connect-migration-email/index.ts) |
| Remove `triggerBakerPayout()` / `PayoutResult` / "Request Payout" button / "no bank account" warning; Express→Standard copy | [PaymentService+Connect.swift](Bakerly/Bakerly/Bakeri/Services/PaymentService+Connect.swift), [BankingPaymentsView.swift](Bakerly/Bakerly/Bakeri/Views/Settings/BankingPaymentsView.swift) |
| Cutover reset SQL (run by hand, NOT via `db push`) | [stripe_standard_cutover_reset.sql](stripe_standard_cutover_reset.sql) |

### Done — decisions (were open questions)

1. **Terminal on Standard** — not supported for platform-driven Terminal →
   Tap to Pay paused (above). `create-terminal-*` functions left untouched; the
   feature flag gates them.
2. **Baker-facing Stripe branding** — accepted.
3. **Radar** — TBD once it's the only remaining line item (minor).
4. **`listExternalAccounts` on Standard** — confirmed **not allowed** (Standard
   accounts own their bank details); `balance.retrieve` / `balanceTransactions
   .list` via `Stripe-Account` **do** work. Code adjusted accordingly.

### Not done

- **Copy pass:** `BakerPayoutSetupView.swift`, `MarketplaceOnboardingGate.swift`
  (both the `Bakeri/` and `MarketFramework/Parti/` copies) — "Express" phrasing,
  "we pay you out" / payout-timing language → baker-controlled.
- **Deploy** (migration + functions) and the operational cutover below.
- **`SUPPORT_LOG.md` entry** — draft at the bottom of this file.
- **Deferred:** per-order `stripe_connect_account_id` snapshot hardening for the
  general "Start over" reconnect path.

## Charges — unchanged

Direct charges on the connected account (`{ stripeAccount }`) with
`application_fee_amount` (doubled for buyer-facing checkouts, single for
baker-initiated). Works identically on Standard. `create-payment-intent`,
`pay-quote-order`, `pay-invoice-order`, `charge-balance-payment`,
`create-guest-*`, `finalize-guest-*` — no change.

`release-baker-payouts` / `payment_model = 'platform_custody'` — untouched; the
cross-baker marketplace still needs a custody model (Express/Custom) when it
reopens. Update `project_bakeri_paused_features_to_reenable`.

`check-connect-account-status` — no change; already classic
`accounts.retrieve` → `charges_enabled/payouts_enabled/details_submitted`, which
is the reliable primary completion signal for Standard. The app calls it on the
Banking screen `.task` and on the `bakeri://connect-return` deep link.

## Operational cutover (order of operations)

1. **Deploy** `20260901000001` (`supabase db push --linked`) + the edge
   functions (`create-connect-account-link`, `get-baker-payout-summary`,
   `stripe-connect-webhook`, `send-connect-migration-email`; delete
   `trigger-baker-payout`).
2. **Stripe dashboard:** add a *snapshot* event destination for `account.updated`
   pointing at the same webhook URL; put its signing secret in
   `STRIPE_CONNECT_WEBHOOK_SECRET_CLASSIC`.
3. **Ship the app build** (payout button gone, copy updated). Old builds show a
   harmless dead code path until updated.
4. **Dry-run the email:** `POST /send-connect-migration-email` with
   `x-webhook-secret`, no body → eyeball the recipient list.
5. **Pre-reset checks:**
   - Pay out Cookiesbysteph's **available** balance:
     `stripe payouts create --amount <cents> --currency cad --stripe-account <acct>`
     (pending auto-sweeps on the account's existing schedule — no action).
   - Confirm no baker has an in-flight direct order:
     ```sql
     SELECT id,user_id,payment_status,marketplace_status FROM orders
     WHERE payment_status IN ('captured','pending','authorized')
       AND marketplace_status NOT IN ('completed','delivered','cancelled')
       AND payment_model = 'direct';
     ```
     Finalize/settle any against the OLD account id first.
6. **Run** `stripe_standard_cutover_reset.sql` by hand. Every storefront goes
   dark (`stripeReady=false`) and every checkout function refuses until each
   baker reconnects.
7. **Send** the email (`{ "send": true }`).
8. **Close the zeroed old Express accounts:** `stripe accounts delete <acct>` for
   every legacy id except Cookiesbysteph's. (Only closes cost/clutter — a dormant
   account already bills $0; deletion does not remove chargeback liability.)
9. **Watch reconnections.** `check-stripe-connect-health` flips + notifies
   stragglers; follow up manually after the deadline.
10. **Later:** once Cookiesbysteph's old account is zero **and** past her last
    Express-era order's ~120-day dispute window, `stripe accounts delete` it.
    Once every baker is `stripe_connect_account_type = 'standard'`, delete the V2
    thin-event path from `stripe-connect-webhook` and any remaining Express-only
    code.

## Rollback

- Steps 1–3 are non-destructive.
- Before the reset (step 6): revert `create-connect-account-link` to
  `type: "express"` and new accounts are Express again.
- After the reset: not cleanly reversible — bakers are reconnecting to Standard.
  The reset itself only nulls pointers (old ids preserved in
  `stripe_connect_express_account_id_legacy`), so a botched run can be re-pointed
  from that column if caught immediately.

---

## Draft `SUPPORT_LOG.md` entry (add when the cutover runs)

```
## 2026-09-XX — Stripe Connect platform fees ≈ application-fee revenue (Express → Standard)

**Reported by:** Harvey, reviewing the Stripe dashboard — ~$15.75 CAD of Connect
platform fees in Aug against ~$20–25 of collected application fees, plus the
platform carrying negative-balance liability for every baker.

**Root cause:** Not a misconfiguration. Bakeri was still on **Express** connected
accounts, whose pricing (CA$2/mo per active account + per-payout + 0.25% volume,
billed to the platform) and platform loss-liability are designed for a
platform-custody model. The 2026-07-30 direct-charge migration removed custody
but left the account type. At current scale the fixed ~$2/active-baker fee
roughly cancels the skim.

**Fix:** Migrated all connected accounts to **Standard** (`type:"standard"` +
Account Links). Direct charges + `application_fee_amount` unchanged; platform
Connect cost → ~$0 and dispute/loss liability moves to the baker. Bakers now own
their Stripe dashboard and payout schedule. Removed `trigger-baker-payout` +
Express login links; `get-baker-payout-summary` no longer calls
`listExternalAccounts` (blocked for Standard). `stripe-connect-webhook` gained a
classic `account.updated` handler. Existing bakers reconnected once (Express
accounts can't convert); old account ids kept in
`stripe_connect_express_account_id_legacy`; zeroed old accounts deleted, the one
with a balance paid out and closed later. Cross-baker marketplace custody flows
(`payment_model='platform_custody'`) unchanged — still Express/Custom when that
reopens. Tap to Pay paused (needs Express/Custom).

**Affected users:** every baker (one-time reconnect).
```

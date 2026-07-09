-- Baker payout tracking for the delayed-transfer model.
-- Checkout now captures the full payment into Bakeri's own Stripe balance
-- (no destination charge) for regular orders. A separate release-baker-payouts
-- sweep transfers each baker's cut to their Connect account once the 24h
-- dispute window (from orders.completed_at) has passed. baker_transfer_id
-- being non-null is what makes the sweep idempotent — an order is only
-- ever transferred once.
--
-- Non-refundable deposits are unaffected by this — they keep transferring
-- immediately at checkout via transfer_data on the PaymentIntent, since
-- there's no dispute risk on money that can't be refunded anyway.

alter table orders
    add column if not exists baker_transfer_id text,
    add column if not exists baker_transferred_at timestamptz;

-- Retroactively documents columns that were already applied directly to
-- production on 2026-06-14 (Stripe Connect onboarding) without a matching
-- local migration file — no-op against the live DB, just closes the gap
-- for anyone re-provisioning from migrations.
alter table profiles
    add column if not exists stripe_connect_account_id text,
    add column if not exists stripe_connect_onboarding_complete boolean not null default false;

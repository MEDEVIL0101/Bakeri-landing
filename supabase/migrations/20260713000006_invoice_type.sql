-- Lets a baker specify what a generated invoice is actually for: the full
-- order total, a deposit (partial amount, card saved for later), or the
-- remaining balance after a deposit was already collected. Previously every
-- invoice always charged the full order_items total with no way to request
-- a deposit or a follow-up balance payment through the invoice-code flow.
--
-- Defaults to 'full' so every existing invoice_code keeps behaving exactly
-- as before.

alter table orders
    add column if not exists invoice_type text not null default 'full'
        check (invoice_type in ('full', 'deposit', 'balance'));

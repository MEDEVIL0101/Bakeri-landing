-- Two baker-authored fields that were previously missing:
-- quote_note: an optional note the baker attaches when sending a custom-order quote.
-- decline_message: the baker's reason for declining a request. Previously this only
-- ever went into order_messages, where it was easy for the buyer to miss entirely.
-- It now gets its own column so the buyer app can surface it prominently instead of
-- burying it in the chat thread.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS quote_note      TEXT,
ADD COLUMN IF NOT EXISTS decline_message TEXT;

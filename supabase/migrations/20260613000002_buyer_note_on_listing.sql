-- Bakers can allow buyers to leave a personalisation note per listing.
-- Default false — opt-in per item (e.g. "Happy Birthday" on a cake).
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS accepts_buyer_note BOOLEAN NOT NULL DEFAULT false;

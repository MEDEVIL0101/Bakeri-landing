-- Add pre-order scheduling options and max quantity cap to menu_items.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS use_drop_date        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS preorder_drop_date   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_preorder_quantity INT         NOT NULL DEFAULT 0;

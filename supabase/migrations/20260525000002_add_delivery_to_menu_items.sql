-- Add delivery availability fields to marketplace menu items
ALTER TABLE public.menu_items
ADD COLUMN IF NOT EXISTS is_delivery_available BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS delivery_fee          DOUBLE PRECISION NOT NULL DEFAULT 0;

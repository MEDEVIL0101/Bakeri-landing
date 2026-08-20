-- ============================================================
-- Intake Form Product Selector
-- Adds a new "product_selector" field type to custom intake
-- forms — lets a baker offer a picklist of priced items (from
-- their own menu, or one-off bundle items) that a buyer picks
-- quantities of, like ordering from a caterer.
-- ============================================================

ALTER TABLE intake_form_fields
    ADD COLUMN IF NOT EXISTS product_options JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'intake_form_fields_type_check'
    ) THEN
        ALTER TABLE intake_form_fields DROP CONSTRAINT intake_form_fields_type_check;
    END IF;

    ALTER TABLE intake_form_fields
        ADD CONSTRAINT intake_form_fields_type_check
        CHECK (field_type IN (
            'heading', 'short_text', 'long_text', 'number',
            'single_choice', 'multi_choice', 'date', 'photo', 'product_selector'
        ));
END $$;

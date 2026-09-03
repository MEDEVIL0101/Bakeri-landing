-- ============================================================
-- Intake Form Time Field
-- Adds a "time" field type to custom intake forms — a proper
-- time-of-day picker, distinct from "date". Forms imported from
-- Google Forms map "Time" questions (e.g. "Pickup Time") to this
-- instead of incorrectly reusing "date".
-- ============================================================

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
            'single_choice', 'multi_choice', 'date', 'time', 'photo', 'product_selector'
        ));
END $$;

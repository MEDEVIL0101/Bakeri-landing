-- ============================================================
-- Intake Form Notice & Agreement Fields
-- Adds "notice" (a read-only paragraph — policies, cancellation
-- terms, disclaimers) and "agreement" (a single required
-- checkbox, e.g. "I agree to the cancellation policy") field
-- types. Neither existing type fit: a heading renders as a bold
-- section title (wrong for a paragraph of policy text), and a
-- single_choice/multi_choice field requires 2+ options, making a
-- lone "I agree" checkbox impossible to build.
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
            'single_choice', 'multi_choice', 'date', 'time', 'photo', 'product_selector',
            'notice', 'agreement'
        ));
END $$;

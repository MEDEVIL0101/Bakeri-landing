-- ============================================================
-- Intake Form Field Conditions
-- Lets a field only show up for buyers when an earlier
-- single/multi-choice field's answer includes a specific value —
-- e.g. a "Cookies" section of fields only appears if the buyer
-- picked "Cookies" in an earlier "What would you like to order?"
-- question. Without this, every section's required fields blocked
-- checkout regardless of what the buyer actually selected.
--
-- No foreign key on condition_field_id: intake_form_fields is
-- saved as a single delete-and-reinsert batch (see
-- IntakeFormService.saveForm), so a field referencing another
-- field inserted in the same statement would need a deferrable
-- constraint to avoid ordering failures. Same "flat, self-describing
-- data over strict relational integrity" tradeoff already used for
-- IntakeFormAnswer elsewhere in this schema.
-- ============================================================

ALTER TABLE intake_form_fields
    ADD COLUMN IF NOT EXISTS condition_field_id UUID,
    ADD COLUMN IF NOT EXISTS condition_values JSONB NOT NULL DEFAULT '[]'::jsonb;

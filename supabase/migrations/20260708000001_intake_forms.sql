-- ============================================================
-- Custom Intake Forms
-- Bakers build reusable intake forms (headings + typed fields),
-- attach them to any listing. When attached, the form replaces
-- the app's built-in brief / buyer-note field for that listing.
-- ============================================================

-- MARK: Tables

CREATE TABLE IF NOT EXISTS intake_forms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intake_form_fields (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id      UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    field_type   TEXT NOT NULL,
    label        TEXT NOT NULL,
    help_text    TEXT,
    is_required  BOOLEAN NOT NULL DEFAULT true,
    options      JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'intake_form_fields_type_check'
    ) THEN
        ALTER TABLE intake_form_fields
            ADD CONSTRAINT intake_form_fields_type_check
            CHECK (field_type IN (
                'heading', 'short_text', 'long_text', 'number',
                'single_choice', 'multi_choice', 'date', 'photo'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS intake_form_fields_form_idx ON intake_form_fields (form_id, position);
CREATE INDEX IF NOT EXISTS intake_forms_user_idx ON intake_forms (user_id);

-- MARK: menu_items — attach a form to a listing

ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS intake_form_id UUID REFERENCES intake_forms(id) ON DELETE SET NULL;

-- MARK: orders / order_items — structured answers captured at request/checkout time

ALTER TABLE orders       ADD COLUMN IF NOT EXISTS form_responses JSONB;
ALTER TABLE order_items  ADD COLUMN IF NOT EXISTS form_responses JSONB;

-- MARK: RLS — intake_forms / intake_form_fields

ALTER TABLE intake_forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_form_fields ENABLE ROW LEVEL SECURITY;

-- Baker: full CRUD on their own forms
CREATE POLICY "baker_manage_own_forms"
ON intake_forms FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Baker: full CRUD on fields belonging to their own forms
CREATE POLICY "baker_manage_own_form_fields"
ON intake_form_fields FOR ALL
USING (
    form_id IN (SELECT id FROM intake_forms WHERE user_id = auth.uid())
)
WITH CHECK (
    form_id IN (SELECT id FROM intake_forms WHERE user_id = auth.uid())
);

-- Public: read a form (and its fields) when it's attached to a live listing —
-- mirrors the marketplace_items_public_read policy on menu_items.
CREATE POLICY "marketplace_form_public_read"
ON intake_forms FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM menu_items
        WHERE menu_items.intake_form_id = intake_forms.id
          AND menu_items.is_listed_in_marketplace = true
          AND menu_items.is_active = true
    )
);

CREATE POLICY "marketplace_form_fields_public_read"
ON intake_form_fields FOR SELECT
USING (
    form_id IN (
        SELECT menu_items.intake_form_id FROM menu_items
        WHERE menu_items.intake_form_id IS NOT NULL
          AND menu_items.is_listed_in_marketplace = true
          AND menu_items.is_active = true
    )
);

-- MARK: Storage — form response photo uploads
-- Buyer-scoped paths ({buyer_id}/{uuid}.jpg) since a Ready Now/Pre-order form
-- is filled out before checkout creates the order row.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-response-photos',
  'form-response-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "buyer_insert_form_response_photo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'form-response-photos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] = auth.uid()::text
);

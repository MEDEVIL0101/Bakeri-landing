-- Same bug as 20260715000001: is_active is an internal menu-management flag
-- (Recipes tab "Activate/Deactivate"), unrelated to marketplace visibility.
-- These two policies required it anyway, so a listed custom-order item with
-- is_active = false (like Tilly's "Decorated Sugar Cookies") had its form
-- silently blocked for anonymous readers — the storefront linked to a form
-- guests could never actually fetch. is_listed_in_marketplace = true is the
-- only signal that should gate public read here.

DROP POLICY IF EXISTS "marketplace_form_public_read" ON public.intake_forms;

CREATE POLICY "marketplace_form_public_read"
ON public.intake_forms FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.menu_items
        WHERE menu_items.intake_form_id = intake_forms.id
          AND menu_items.is_listed_in_marketplace = true
    )
);

DROP POLICY IF EXISTS "marketplace_form_fields_public_read" ON public.intake_form_fields;

CREATE POLICY "marketplace_form_fields_public_read"
ON public.intake_form_fields FOR SELECT
USING (
    form_id IN (
        SELECT menu_items.intake_form_id
        FROM public.menu_items
        WHERE menu_items.intake_form_id IS NOT NULL
          AND menu_items.is_listed_in_marketplace = true
    )
);

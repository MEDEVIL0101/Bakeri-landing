-- Partner pages live in partner_pages (20261115000008); nothing reads the
-- old vendor-profile flag any more.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_partner_page;

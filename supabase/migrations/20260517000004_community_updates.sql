-- ============================================================
-- Community updates: community_handle, user-created groups,
-- additional seeded groups
-- ============================================================

-- Add community username to profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS community_handle text NOT NULL DEFAULT '';

-- Allow users to create their own community groups
ALTER TABLE public.community_groups
    ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE POLICY "groups_insert"
    ON public.community_groups FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-join group creator as the first member (SECURITY DEFINER bypasses RLS for the insert)
CREATE OR REPLACE FUNCTION public.fn_auto_join_group_creator()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.created_by_user_id IS NOT NULL THEN
        INSERT INTO public.community_group_members (group_id, user_id)
        VALUES (NEW.id, NEW.created_by_user_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_auto_join_group_creator
    AFTER INSERT ON public.community_groups
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_join_group_creator();

-- View: groups with active-user count (thread or comment author in last 72 h)
CREATE VIEW public.community_groups_with_activity AS
SELECT
    g.*,
    (
        SELECT COUNT(DISTINCT t.author_id)
        FROM public.community_threads t
        WHERE t.group_id = g.id
          AND t.created_at > NOW() - INTERVAL '72 hours'
    ) + (
        SELECT COUNT(DISTINCT c.author_id)
        FROM public.community_comments c
        JOIN public.community_threads t2 ON t2.id = c.thread_id
        WHERE t2.group_id = g.id
          AND c.created_at > NOW() - INTERVAL '72 hours'
    ) AS active_user_count
FROM public.community_groups g;

-- Seed additional groups
INSERT INTO public.community_groups (name, description, icon_name, is_featured) VALUES
  ('Help & How-Tos',          'Got a baking question? This is the place — tips, troubleshooting, and guidance at every level.',    'questionmark.circle.fill',   true),
  ('Equipment & Tools',       'Stand mixers, ovens, pans, and gadgets — share reviews, recommendations, and repairs.',             'wrench.and.screwdriver.fill', false),
  ('Recipe Sharing',          'Post your originals, family recipes, and favourite tweaks on the classics.',                        'fork.knife',                 true),
  ('Cookies & Biscuits',      'Drop cookies, cutouts, macarons, biscotti — anything in the cookie family.',                       'circle.grid.3x3.fill',       false),
  ('Donuts & Fried Dough',    'Yeast donuts, cake donuts, beignets, churros, and everything in between.',                         'circle.fill',                false),
  ('Chocolate & Confections', 'Tempering chocolate, truffles, bonbons, and cocoa-rich baking of all kinds.',                      'drop.fill',                  false),
  ('Gluten-Free Baking',      'Alternative flours, allergy-friendly recipes, and tips for baking without gluten.',                'leaf.circle.fill',           false),
  ('Custom Orders & Pricing', 'Price your work, package it beautifully, and grow your home bakery business.',                     'bag.fill',                   false);

-- Global tag registry: single source of truth for all tags used in
-- baker specialty profiles, post composition, and directory search.

CREATE TABLE IF NOT EXISTS public.baker_specialty_tags (
    name TEXT PRIMARY KEY
);

-- Seed with all initial tags (same set available in compose + directory)
INSERT INTO public.baker_specialty_tags (name) VALUES
    -- Baked goods
    ('Sourdough'), ('Birthday Cake'), ('Wedding Cake'), ('Cookies'), ('Bread'),
    ('Croissants'), ('Macarons'), ('Chocolate'), ('Cupcakes'), ('Donuts'),
    ('Tarts'), ('Brownies'), ('Cheesecake'), ('Cinnamon Roll'), ('Baguette'),
    ('Focaccia'), ('Brioche'), ('Pies'), ('Scones'), ('Muffins'),
    ('Cakes'), ('Pastry'), ('Bagels'), ('Pretzels'), ('Danish'),
    ('Eclairs'), ('Profiteroles'), ('Strudel'), ('Baklava'), ('Cannoli'),
    ('Crepes'), ('Waffles'), ('Quiche'),
    -- Styles & themes
    ('Tutorial'), ('Behind the Scenes'), ('New Recipe'), ('Custom Design'),
    ('Tiered Cake'), ('Seasonal'), ('Holiday'), ('Fondant Work'), ('Sugar Art'),
    ('Piping'), ('Cake Decorating'), ('Bread Baking'), ('Small Business'),
    ('Custom Orders'), ('Wholesale'), ('Farmers Market'), ('Online Orders'),
    ('Bespoke'), ('Edible Art'), ('Drip Cakes'), ('Naked Cakes'),
    ('Celebration Cakes'), ('Novelty Cakes'), ('Sculpted Cakes'),
    ('Number Cakes'), ('Floral Cakes'), ('Layer Cakes'),
    -- Flavours
    ('Vanilla'), ('Lemon'), ('Carrot'), ('Red Velvet'), ('Matcha'),
    ('Strawberry'), ('Caramel'), ('Coffee'), ('Raspberry'), ('Blueberry'),
    ('Hazelnut'), ('Salted Caramel'), ('Lavender'), ('Rose'), ('Earl Grey'),
    ('Pistachio'), ('Mango'), ('Passionfruit'), ('Coconut'), ('Banana'),
    ('Cinnamon'), ('Ginger'), ('Peanut Butter'), ('Tahini'),
    -- Dietary
    ('Gluten-Free'), ('Vegan'), ('Dairy-Free'), ('Nut-Free'),
    ('Keto'), ('Sugar-Free'), ('Paleo'), ('Egg-Free'),
    ('Halal'), ('Kosher'), ('Low-Carb')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.baker_specialty_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read specialty tags"
    ON public.baker_specialty_tags FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users can add specialty tags"
    ON public.baker_specialty_tags FOR INSERT
    TO authenticated
    WITH CHECK (true);

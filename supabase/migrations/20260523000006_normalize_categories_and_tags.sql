-- Normalize community_threads tags: collapse plural/singular variants to canonical forms.
-- Canonical set matches the ShopView category names used client-side.

UPDATE community_threads
SET tags = (
    SELECT array_agg(
        CASE
            WHEN lower(t) IN ('cakes','gateaux','gateau','birthday cake','wedding cake')           THEN 'Cake'
            WHEN lower(t) IN ('cookie','biscuit','biscuits','sugar cookies','sugar cookie')        THEN 'Cookies'
            WHEN lower(t) IN ('cupcake')                                                           THEN 'Cupcakes'
            WHEN lower(t) IN ('donut','doughnuts','doughnut')                                      THEN 'Donuts'
            WHEN lower(t) IN ('macaron','macaroon','macaroons')                                    THEN 'Macarons'
            WHEN lower(t) IN ('pastry','tarts','tart','croissants','scones','danish','danishes')   THEN 'Pastries'
            WHEN lower(t) IN ('cake pop','cakepop','cakepops')                                     THEN 'Cake Pops'
            WHEN lower(t) IN ('treat','brownie','brownies','bars','bar','fudge','truffles')        THEN 'Treats'
            WHEN lower(t) IN ('breads','loaf','loaves','sourdough bread','white bread')            THEN 'Bread'
            ELSE t
        END
    )
    FROM unnest(tags) AS t
)
WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

-- Normalize menu_items category field similarly.
UPDATE menu_items SET category = 'Cake'             WHERE lower(category) IN ('cakes','gateau','gateaux');
UPDATE menu_items SET category = 'Cookies'          WHERE lower(category) IN ('cookie','biscuit','biscuits');
UPDATE menu_items SET category = 'Cupcakes'         WHERE lower(category) = 'cupcake';
UPDATE menu_items SET category = 'Donuts'           WHERE lower(category) IN ('donut','doughnut','doughnuts');
UPDATE menu_items SET category = 'Macarons'         WHERE lower(category) IN ('macaron','macaroon','macaroons');
UPDATE menu_items SET category = 'Pastries'         WHERE lower(category) IN ('pastry','tart','tarts','croissant','croissants','danish','scone','scones');
UPDATE menu_items SET category = 'Cake Pops'        WHERE lower(category) IN ('cake pop','cakepop','cakepops');
UPDATE menu_items SET category = 'Bread'            WHERE lower(category) IN ('breads','loaf','loaves');

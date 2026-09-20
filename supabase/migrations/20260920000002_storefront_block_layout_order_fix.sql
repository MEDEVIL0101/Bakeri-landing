-- Correction to 20260920000001: that migration's default array had
-- "digital" before "physical", copied from STOREFRONT_DESIGN_BRIEF.md's
-- section table — which turns out to be stale relative to the actual
-- baker/index.html markup, where #physical-feed (line 944) renders BEFORE
-- #digital-feed (line 946). Since the block-layout column is brand new and
-- no client (web or iOS) reads/writes it yet, every existing row still just
-- holds that first migration's literal default — safe to correct in place
-- with a blanket UPDATE rather than a conditional one.
--
-- Without this fix, the first web/iOS code to actually apply this column
-- would have silently swapped Ships to You and Digital Downloads on every
-- baker's live storefront the moment it shipped — exactly the kind of
-- unintended change this whole feature is designed to avoid.

UPDATE public.profiles
SET storefront_block_layout = '[
    {"type":"menu","hidden":false},
    {"type":"physical","hidden":false},
    {"type":"digital","hidden":false},
    {"type":"links","hidden":false},
    {"type":"about","hidden":false},
    {"type":"faq","hidden":false},
    {"type":"policies","hidden":false},
    {"type":"hours","hidden":false}
]'::jsonb
WHERE storefront_block_layout = '[
    {"type":"menu","hidden":false},
    {"type":"digital","hidden":false},
    {"type":"physical","hidden":false},
    {"type":"links","hidden":false},
    {"type":"about","hidden":false},
    {"type":"faq","hidden":false},
    {"type":"policies","hidden":false},
    {"type":"hours","hidden":false}
]'::jsonb;

ALTER TABLE public.profiles
    ALTER COLUMN storefront_block_layout
    SET DEFAULT '[
        {"type":"menu","hidden":false},
        {"type":"physical","hidden":false},
        {"type":"digital","hidden":false},
        {"type":"links","hidden":false},
        {"type":"about","hidden":false},
        {"type":"faq","hidden":false},
        {"type":"policies","hidden":false},
        {"type":"hours","hidden":false}
    ]'::jsonb;

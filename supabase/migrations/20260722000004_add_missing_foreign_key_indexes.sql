-- Advisor: unindexed_foreign_keys (26). Every foreign-key column below has
-- no covering index, forcing a sequential scan on the referencing table for
-- any join/cascade-delete/RLS-subquery check through that FK. Tables are
-- small at current scale, so plain (non-concurrent) CREATE INDEX is fine.

CREATE INDEX IF NOT EXISTS idx_recipes_user_id                          ON public.recipes (user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id             ON public.recipe_ingredients (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_user_id               ON public.recipe_ingredients (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id                     ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_recipe_id                    ON public.order_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_order_items_user_id                      ON public.order_items (user_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_intake_form_id                ON public.menu_items (intake_form_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_recipe_id                     ON public.menu_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_baking_tasks_order_id                    ON public.baking_tasks (order_id);
CREATE INDEX IF NOT EXISTS idx_baking_tasks_recipe_id                   ON public.baking_tasks (recipe_id);
CREATE INDEX IF NOT EXISTS idx_baking_tasks_user_id                     ON public.baking_tasks (user_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_densities_user_id             ON public.ingredient_densities (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id                         ON public.feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_community_groups_created_by_user_id      ON public.community_groups (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_community_threads_marketplace_listing_id ON public.community_threads (marketplace_listing_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_author_id             ON public.community_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_community_comments_parent_id             ON public.community_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_community_thread_views_user_id           ON public.community_thread_views (user_id);
CREATE INDEX IF NOT EXISTS idx_community_activity_feed_actor_id         ON public.community_activity_feed (actor_id);
CREATE INDEX IF NOT EXISTS idx_community_activity_feed_comment_id       ON public.community_activity_feed (comment_id);
CREATE INDEX IF NOT EXISTS idx_community_activity_feed_thread_id        ON public.community_activity_feed (thread_id);
CREATE INDEX IF NOT EXISTS idx_directory_claims_user_id                 ON public.directory_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter_id                 ON public.user_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_admin_order_actions_order_id             ON public.admin_order_actions (order_id);
CREATE INDEX IF NOT EXISTS idx_pos_sync_log_user_id                     ON public.pos_sync_log (user_id);
CREATE INDEX IF NOT EXISTS idx_preorder_batches_menu_item_id            ON public.preorder_batches (menu_item_id);

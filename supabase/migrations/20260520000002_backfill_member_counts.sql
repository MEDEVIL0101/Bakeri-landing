-- Recalculate member_count for every group from actual membership rows.
-- Fixes groups whose count stayed at 0 because memberships were inserted before
-- the trigger existed, or via SECURITY DEFINER paths that pre-date the trigger.
UPDATE public.community_groups g
SET member_count = (
    SELECT COUNT(*)
    FROM public.community_group_members m
    WHERE m.group_id = g.id
);

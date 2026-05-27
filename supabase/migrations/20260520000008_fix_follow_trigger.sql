-- The fn_baker_follow_counts trigger was not SECURITY DEFINER, so it ran under
-- the calling user's RLS context. When User A follows User B, the trigger tries
-- to UPDATE User B's follower_count — but RLS blocks updating another user's
-- profile row, causing the INSERT to roll back and follow to silently fail.
-- Recreating the function as SECURITY DEFINER so it bypasses RLS.

CREATE OR REPLACE FUNCTION public.fn_baker_follow_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.profiles SET follower_count  = follower_count  + 1 WHERE id = NEW.following_id;
        UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.profiles SET follower_count  = GREATEST(follower_count  - 1, 0) WHERE id = OLD.following_id;
        UPDATE public.profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    END IF;
    RETURN NULL;
END;
$$;

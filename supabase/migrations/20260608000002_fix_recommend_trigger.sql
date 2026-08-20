-- Fix handle_baker_recommend trigger to use schema-qualified table names.
-- Supabase runs with search_path='' so unqualified names silently resolve to nothing.

CREATE OR REPLACE FUNCTION public.handle_baker_recommend()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.profiles
            SET recommend_count = recommend_count + 1
            WHERE id = NEW.baker_id;

        INSERT INTO public.community_activity_feed
            (recipient_id, actor_id, event_type, is_read, created_at)
        VALUES
            (NEW.baker_id, NEW.recommender_id, 'recommend_baker', FALSE, NOW());

    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.profiles
            SET recommend_count = GREATEST(0, recommend_count - 1)
            WHERE id = OLD.baker_id;
    END IF;
    RETURN NULL;
END;
$$;

-- Reattach trigger (idempotent)
DROP TRIGGER IF EXISTS on_baker_recommend ON public.baker_recommends;
CREATE TRIGGER on_baker_recommend
    AFTER INSERT OR DELETE ON public.baker_recommends
    FOR EACH ROW EXECUTE FUNCTION public.handle_baker_recommend();

-- Backfill recommend_count for any existing rows
UPDATE public.profiles p
    SET recommend_count = (
        SELECT COUNT(*) FROM public.baker_recommends br WHERE br.baker_id = p.id
    );

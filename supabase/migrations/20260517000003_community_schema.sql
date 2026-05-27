-- ============================================================
-- Bakeri Community Schema
-- ============================================================

-- GROUPS
CREATE TABLE public.community_groups (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  icon_name    text        NOT NULL DEFAULT 'fork.knife',
  is_featured  bool        NOT NULL DEFAULT false,
  member_count int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- GROUP MEMBERSHIPS
CREATE TABLE public.community_group_members (
  group_id  uuid        NOT NULL REFERENCES public.community_groups(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- THREADS
CREATE TABLE public.community_threads (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid        NOT NULL REFERENCES public.community_groups(id) ON DELETE CASCADE,
  author_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  body          text        NOT NULL DEFAULT '',
  is_pinned     bool        NOT NULL DEFAULT false,
  like_count    int         NOT NULL DEFAULT 0,
  comment_count int         NOT NULL DEFAULT 0,
  view_count    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- COMMENTS
CREATE TABLE public.community_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid        NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id  uuid        REFERENCES public.community_comments(id) ON DELETE CASCADE,
  body       text        NOT NULL,
  like_count int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- LIKES (thread or comment, unified table)
CREATE TABLE public.community_likes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('thread', 'comment')),
  target_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

-- THREAD VIEWS (one row per user+thread; upsert on open)
CREATE TABLE public.community_thread_views (
  thread_id uuid        NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- ACTIVITY FEED
CREATE TABLE public.community_activity_feed (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   text        NOT NULL,
  thread_id    uuid        REFERENCES public.community_threads(id) ON DELETE CASCADE,
  comment_id   uuid        REFERENCES public.community_comments(id) ON DELETE SET NULL,
  is_read      bool        NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX idx_community_threads_group    ON public.community_threads(group_id);
CREATE INDEX idx_community_threads_author   ON public.community_threads(author_id);
CREATE INDEX idx_community_comments_thread  ON public.community_comments(thread_id);
CREATE INDEX idx_community_likes_target     ON public.community_likes(target_type, target_id);
CREATE INDEX idx_community_activity_recip   ON public.community_activity_feed(recipient_id, is_read);
CREATE INDEX idx_community_members_user     ON public.community_group_members(user_id);

-- ── TRIGGERS: denormalized counts ─────────────────────────────

CREATE OR REPLACE FUNCTION fn_community_thread_like_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.target_type = 'thread' THEN
    UPDATE public.community_threads SET like_count = like_count + 1 WHERE id = NEW.target_id;
  ELSIF TG_OP = 'DELETE' AND OLD.target_type = 'thread' THEN
    UPDATE public.community_threads SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.target_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_thread_like_count
AFTER INSERT OR DELETE ON public.community_likes
FOR EACH ROW EXECUTE FUNCTION fn_community_thread_like_count();

CREATE OR REPLACE FUNCTION fn_community_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.target_type = 'comment' THEN
    UPDATE public.community_comments SET like_count = like_count + 1 WHERE id = NEW.target_id;
  ELSIF TG_OP = 'DELETE' AND OLD.target_type = 'comment' THEN
    UPDATE public.community_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.target_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_comment_like_count
AFTER INSERT OR DELETE ON public.community_likes
FOR EACH ROW EXECUTE FUNCTION fn_community_comment_like_count();

CREATE OR REPLACE FUNCTION fn_community_thread_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_threads SET comment_count = comment_count + 1 WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_threads SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.thread_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_thread_comment_count
AFTER INSERT OR DELETE ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION fn_community_thread_comment_count();

CREATE OR REPLACE FUNCTION fn_community_thread_view_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.community_threads SET view_count = view_count + 1 WHERE id = NEW.thread_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_thread_view_count
AFTER INSERT ON public.community_thread_views
FOR EACH ROW EXECUTE FUNCTION fn_community_thread_view_count();

CREATE OR REPLACE FUNCTION fn_community_group_member_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_groups SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.group_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_group_member_count
AFTER INSERT OR DELETE ON public.community_group_members
FOR EACH ROW EXECUTE FUNCTION fn_community_group_member_count();

CREATE OR REPLACE FUNCTION fn_community_activity_on_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_thread_author uuid;
  v_parent_author uuid;
BEGIN
  SELECT author_id INTO v_thread_author FROM public.community_threads WHERE id = NEW.thread_id;
  IF v_thread_author IS NOT NULL AND v_thread_author <> NEW.author_id THEN
    INSERT INTO public.community_activity_feed (recipient_id, actor_id, event_type, thread_id, comment_id)
    VALUES (v_thread_author, NEW.author_id, 'reply_to_thread', NEW.thread_id, NEW.id);
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT author_id INTO v_parent_author FROM public.community_comments WHERE id = NEW.parent_id;
    IF v_parent_author IS NOT NULL AND v_parent_author <> NEW.author_id AND v_parent_author <> COALESCE(v_thread_author, NEW.author_id) THEN
      INSERT INTO public.community_activity_feed (recipient_id, actor_id, event_type, thread_id, comment_id)
      VALUES (v_parent_author, NEW.author_id, 'reply_to_comment', NEW.thread_id, NEW.id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_activity_on_comment
AFTER INSERT ON public.community_comments
FOR EACH ROW EXECUTE FUNCTION fn_community_activity_on_comment();

CREATE OR REPLACE FUNCTION fn_community_activity_on_like()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_author   uuid;
  v_thread   uuid;
BEGIN
  IF NEW.target_type = 'thread' THEN
    SELECT author_id INTO v_author FROM public.community_threads WHERE id = NEW.target_id;
    v_thread := NEW.target_id;
    IF v_author IS NOT NULL AND v_author <> NEW.user_id THEN
      INSERT INTO public.community_activity_feed (recipient_id, actor_id, event_type, thread_id)
      VALUES (v_author, NEW.user_id, 'like_thread', v_thread);
    END IF;
  ELSIF NEW.target_type = 'comment' THEN
    SELECT author_id, thread_id INTO v_author, v_thread FROM public.community_comments WHERE id = NEW.target_id;
    IF v_author IS NOT NULL AND v_author <> NEW.user_id THEN
      INSERT INTO public.community_activity_feed (recipient_id, actor_id, event_type, thread_id, comment_id)
      VALUES (v_author, NEW.user_id, 'like_comment', v_thread, NEW.target_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_community_activity_on_like
AFTER INSERT ON public.community_likes
FOR EACH ROW EXECUTE FUNCTION fn_community_activity_on_like();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.community_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_threads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_likes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_thread_views    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_activity_feed   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups_select"          ON public.community_groups          FOR SELECT USING (true);
CREATE POLICY "members_select"         ON public.community_group_members   FOR SELECT USING (true);
CREATE POLICY "members_insert"         ON public.community_group_members   FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members_delete"         ON public.community_group_members   FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "threads_select"         ON public.community_threads         FOR SELECT USING (true);
CREATE POLICY "threads_insert"         ON public.community_threads         FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "threads_update"         ON public.community_threads         FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "threads_delete"         ON public.community_threads         FOR DELETE USING (auth.uid() = author_id);
CREATE POLICY "comments_select"        ON public.community_comments        FOR SELECT USING (true);
CREATE POLICY "comments_insert"        ON public.community_comments        FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "comments_delete"        ON public.community_comments        FOR DELETE USING (auth.uid() = author_id);
CREATE POLICY "likes_select"           ON public.community_likes           FOR SELECT USING (true);
CREATE POLICY "likes_insert"           ON public.community_likes           FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete"           ON public.community_likes           FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "views_insert"           ON public.community_thread_views    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "views_select"           ON public.community_thread_views    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "activity_select"        ON public.community_activity_feed   FOR SELECT USING (auth.uid() = recipient_id);
CREATE POLICY "activity_update"        ON public.community_activity_feed   FOR UPDATE USING (auth.uid() = recipient_id);

-- Seed starter groups
INSERT INTO public.community_groups (name, description, icon_name, is_featured) VALUES
  ('Sourdough Bakers',      'Share your starters, crumb shots, and proofing wins.',     'flame.fill',         true),
  ('Cake Decorating',       'Fondant, buttercream, ganache — show it all off.',          'birthday.cake.fill', true),
  ('Pastry & Viennoiserie', 'Croissants, danish, and laminated dough deep dives.',       'leaf.fill',          true),
  ('Cookie Club',           'Drop cookies, cutouts, sandwich cookies and more.',         'star.fill',          false),
  ('Bread Basics',          'A safe space for beginner bakers learning the ropes.',      'book.fill',          false),
  ('Business of Baking',    'Pricing, packaging, markets, and running your bakery biz.', 'chart.bar.fill',     false);

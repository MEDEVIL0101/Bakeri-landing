-- Rate limits for marketplace write endpoints.
--
-- order_messages: 60 messages per user per hour.
--   A legitimate baker with many active orders would rarely hit this.
--   An attacker spamming a specific baker's inbox will be blocked after 60 attempts.
--
-- orders (buyer INSERT): 4 orders per buyer per hour.
--   Quote requests require no payment upfront, so without this a single account
--   could flood every baker on the platform with fake requests.
--
-- community_likes: 200 likes per user per hour.
--   Each like fires an activity notification to the thread author. Uncapped,
--   a script can trigger thousands of push notifications per minute.

-- ─── order_messages ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "order_messages_insert" ON public.order_messages;
CREATE POLICY "order_messages_insert"
ON public.order_messages
FOR INSERT
WITH CHECK (
    sender_profile_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = order_messages.order_id
          AND (o.user_id = auth.uid() OR o.buyer_profile_id = auth.uid())
    )
    AND (
        SELECT COUNT(*)
        FROM public.order_messages
        WHERE sender_profile_id = auth.uid()
          AND created_at > NOW() - INTERVAL '1 hour'
    ) < 60
);

-- ─── orders (buyer quote requests) ───────────────────────────────────────────

DROP POLICY IF EXISTS "marketplace_buyer_create_order" ON public.orders;
CREATE POLICY "marketplace_buyer_create_order"
ON public.orders
FOR INSERT
WITH CHECK (
    order_source = 'marketplace'
    AND marketplace_status = 'pending_quote'
    AND buyer_profile_id = auth.uid()
    AND payment_intent_id IS NULL
    AND (
        SELECT COUNT(*)
        FROM public.orders
        WHERE buyer_profile_id = auth.uid()
          AND order_source = 'marketplace'
          AND created_at > NOW() - INTERVAL '1 hour'
    ) < 4
);

-- ─── community_likes ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "likes_insert" ON public.community_likes;
CREATE POLICY "likes_insert"
ON public.community_likes
FOR INSERT
WITH CHECK (
    auth.uid() = user_id
    AND (
        SELECT COUNT(*)
        FROM public.community_likes
        WHERE user_id = auth.uid()
          AND created_at > NOW() - INTERVAL '1 hour'
    ) < 200
);

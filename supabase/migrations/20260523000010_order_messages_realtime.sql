-- Enable Supabase Realtime for order_messages so the iOS client
-- receives INSERT events instantly without polling.
ALTER PUBLICATION supabase_realtime ADD TABLE order_messages;

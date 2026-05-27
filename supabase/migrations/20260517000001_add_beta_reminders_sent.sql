CREATE TABLE IF NOT EXISTS beta_reminders_sent (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  email      text        UNIQUE NOT NULL,
  sent_at    timestamptz DEFAULT now()
);

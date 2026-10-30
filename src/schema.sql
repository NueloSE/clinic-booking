-- Run on every server start (see migrate() in db.js), so every statement
-- must be safe to repeat.

CREATE TABLE IF NOT EXISTS slots (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  -- start/end exactly as the client sent them, so we return the same strings.
  start_text  TEXT NOT NULL,
  end_text    TEXT NOT NULL,
  -- The same times parsed, for sorting and for "has this slot started?".
  start_at    TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  -- seq gives a strict insertion order (created_at can tie within a millisecond).
  seq         BIGSERIAL PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  slot_id     TEXT NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one confirmed booking per slot. Postgres checks this on every insert,
-- so two requests at the same moment can't both succeed. Cancelled bookings
-- don't count, which is what frees a slot when its booking is cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_booking_per_slot
  ON bookings (slot_id) WHERE status = 'confirmed';

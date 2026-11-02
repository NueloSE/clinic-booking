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

-- Finds one person's bookings in order without reading every row (GET /bookings).
CREATE INDEX IF NOT EXISTS bookings_by_email ON bookings (email, seq);

-- One row per Idempotency-Key: a fingerprint of the request body and the
-- response we sent, so a retry gets the same response instead of a new booking.
-- status_code and response_body stay empty while the first request is running.
-- response_body is JSON, not JSONB: JSONB reorders keys, JSON keeps the exact text.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  request_hash   TEXT NOT NULL,
  status_code    INTEGER,
  response_body  JSON,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per booking attempt, for the limit of 5 attempts per email per
-- minute. An email's rows older than a minute are deleted each time it tries again.
CREATE TABLE IF NOT EXISTS booking_attempts (
  email         TEXT NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_attempts_by_email
  ON booking_attempts (email, attempted_at);

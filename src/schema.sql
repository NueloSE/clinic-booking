-- Runs on every server start, so every statement must be safe to repeat.

CREATE TABLE IF NOT EXISTS slots (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  -- Exactly as sent, so we return the same strings.
  start_text  TEXT NOT NULL,
  end_text    TEXT NOT NULL,
  -- Parsed, for sorting and the "has it started?" check.
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

-- One confirmed booking per slot, enforced even for simultaneous requests.
-- Cancelled bookings don't count, so cancelling frees the slot.
CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_booking_per_slot
  ON bookings (slot_id) WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS bookings_by_email ON bookings (email, seq);

-- JSON, not JSONB: JSONB reorders keys, so a replay wouldn't match exactly.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key            TEXT PRIMARY KEY,
  request_hash   TEXT NOT NULL,
  status_code    INTEGER,
  response_body  JSON,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_attempts (
  email         TEXT NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_attempts_by_email
  ON booking_attempts (email, attempted_at);

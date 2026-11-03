import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool, withTransaction } from './db.js';

function toSlot(row) {
  return {
    id: row.id,
    provider: row.provider,
    start: row.start_text,
    end: row.end_text,
  };
}

function toBooking(row) {
  return {
    id: row.id,
    slot_id: row.slot_id,
    name: row.name,
    email: row.email,
    status: row.status,
    created_at: row.created_at.toISOString(),
  };
}

function isValidSlot(slot) {
  return (
    typeof slot?.id === 'string' && slot.id !== '' &&
    typeof slot.provider === 'string' &&
    typeof slot.start === 'string' &&
    typeof slot.end === 'string'
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseNewBooking(body) {
  const slotId = body?.slot_id;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (typeof slotId !== 'string' || slotId === '') return { error: 'slot_id is required' };
  if (name === '') return { error: 'name is required' };
  if (email === '') return { error: 'email is required' };
  if (!EMAIL_PATTERN.test(email)) return { error: 'email is not valid' };
  return { booking: { slotId, name, email } };
}

// JSON with object keys sorted, so bodies that differ only in key order or
// spacing produce the same text.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(body) {
  return createHash('sha256').update(canonicalJson(body ?? null)).digest('hex');
}

// The cursor is the seq of the last booking on a page, base64url-encoded so
// clients treat it as an opaque token.
function encodeCursor(seq) {
  return Buffer.from(String(seq)).toString('base64url');
}

// Returns the seq inside a cursor, or null if it isn't one of ours.
// At most 18 digits so it always fits in a Postgres bigint.
function decodeCursor(cursor) {
  const text = Buffer.from(cursor, 'base64url').toString();
  return /^\d{1,18}$/.test(text) ? text : null;
}

const MAX_ATTEMPTS = 5;

// Records a booking attempt for the body's email, or returns a 429 response if
// that email already made MAX_ATTEMPTS in the last minute. Returns null when
// the attempt is allowed. Failed attempts count, because this runs before any
// other check.
async function checkRateLimit(client, body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === '') {
    return null; // Nothing to count against; validation will turn it away.
  }

  // A lock named after the email, held until our transaction ends. Requests
  // for the same email take turns from here, so they can't all count 4 at
  // once and all get in. Other emails use other locks and never wait.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);

  // clock_timestamp() is the time right now. now() is when the transaction
  // started, which can be earlier if we waited for the lock.
  await client.query(
    `DELETE FROM booking_attempts
     WHERE email = $1 AND attempted_at <= clock_timestamp() - interval '60 seconds'`,
    [email],
  );
  const { rows } = await client.query(
    `SELECT count(*)::int AS attempts,
            ceil(extract(epoch FROM min(attempted_at) + interval '60 seconds' - clock_timestamp()))::int
              AS retry_after
     FROM booking_attempts
     WHERE email = $1`,
    [email],
  );
  // A rejected attempt isn't recorded, so the wait in Retry-After stays true.
  if (rows[0].attempts >= MAX_ATTEMPTS) {
    return {
      status: 429,
      body: { error: 'too many booking attempts, try again later' },
      retryAfter: Math.max(1, rows[0].retry_after),
    };
  }

  await client.query(
    'INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, clock_timestamp())',
    [email],
  );
  return null;
}

// Applies the booking rules using a transaction's client and returns the
// response to send instead of sending it, so it can also be saved for an
// Idempotency-Key.
async function createBooking(client, body) {
  const { booking, error } = parseNewBooking(body);
  if (error) {
    return { status: 400, body: { error } };
  }

  // The database's clock decides "started", so our server's clock can't be wrong.
  const slot = await client.query(
    'SELECT start_at <= now() AS started FROM slots WHERE id = $1',
    [booking.slotId],
  );
  if (slot.rows.length === 0) {
    return { status: 404, body: { error: 'slot not found' } };
  }
  if (slot.rows[0].started) {
    return { status: 400, body: { error: 'slot has already started' } };
  }

  // No "is it booked?" check first: two requests could both pass it before
  // either inserts. We just insert and let the unique index decide. If the slot
  // already has a confirmed booking, ON CONFLICT skips the insert and no row
  // comes back. Unlike an error, that doesn't abort a surrounding transaction.
  const { rows } = await client.query(
    `INSERT INTO bookings (id, slot_id, name, email, status)
     VALUES ($1, $2, $3, $4, 'confirmed')
     ON CONFLICT (slot_id) WHERE status = 'confirmed' DO NOTHING
     RETURNING *`,
    [randomUUID(), booking.slotId, booking.name, booking.email],
  );
  if (rows.length === 0) {
    return { status: 409, body: { error: 'slot already booked' } };
  }
  return { status: 201, body: toBooking(rows[0]) };
}

async function attemptBooking(client, body) {
  return (await checkRateLimit(client, body)) ?? createBooking(client, body);
}

// Runs attemptBooking at most once per Idempotency-Key, inside a transaction.
// A replay or a 422 isn't a new attempt, so neither counts towards the rate limit.
async function createBookingOnce(client, key, body) {
  const hash = fingerprint(body);

  // Claim the key before doing anything else. If another request holds it,
  // Postgres makes us wait here until that request commits or rolls back.
  const claim = await client.query(
    `INSERT INTO idempotency_keys (key, request_hash)
     VALUES ($1, $2)
     ON CONFLICT (key) DO NOTHING`,
    [key, hash],
  );

  // The key was already used: replay the saved response, or 422 if the body differs.
  if (claim.rowCount === 0) {
    const { rows } = await client.query(
      'SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = $1',
      [key],
    );
    if (rows[0].request_hash !== hash) {
      return { status: 422, body: { error: 'Idempotency-Key was already used with a different request' } };
    }
    return { status: rows[0].status_code, body: rows[0].response_body };
  }

  const result = await attemptBooking(client, body);
  if (result.status === 429) {
    // Not saved: after waiting, a retry with this key should get a real try.
    await client.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
  } else {
    await client.query(
      'UPDATE idempotency_keys SET status_code = $2, response_body = $3 WHERE key = $1',
      [key, result.status, result.body],
    );
  }
  return result;
}

function createApp() {
  if (!process.env.API_KEY) {
    throw new Error('API_KEY is not set');
  }
  const expectedKey = Buffer.from(process.env.API_KEY);

  const app = express();

  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  // The React web page, built into public/ by `npm run build`. It needs no key
  // to load, but it asks the user for the key and sends it with every API call,
  // like any other client. (On Vercel the CDN serves public/ and this line is
  // ignored; locally it serves the page.)
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  // Every other request must carry the right X-API-Key. timingSafeEqual takes
  // the same time however many characters match, so the key can't be guessed
  // by timing responses. It needs equal lengths, hence the length check first.
  app.use((req, res, next) => {
    const sentKey = Buffer.from(req.get('X-API-Key') ?? '');
    if (sentKey.length !== expectedKey.length || !timingSafeEqual(sentKey, expectedKey)) {
      return res.status(401).json({ error: 'missing or invalid API key' });
    }
    next();
  });

  // After the key check, so a request without a key gets 401 even if its body is broken.
  app.use(express.json());

  // Deletes every booking and replaces all slots, in one transaction so a
  // failure halfway leaves the old data untouched.
  app.post('/reset', async (req, res) => {
    const slots = req.body?.slots;
    if (!Array.isArray(slots) || !slots.every(isValidSlot)) {
      return res.status(400).json({ error: 'slots must be an array of {id, provider, start, end}' });
    }
    if (new Set(slots.map((s) => s.id)).size !== slots.length) {
      return res.status(400).json({ error: 'slot ids must be unique' });
    }

    try {
      await withTransaction(async (client) => {
        await client.query('DELETE FROM booking_attempts');
        await client.query('DELETE FROM idempotency_keys');
        await client.query('DELETE FROM bookings');
        await client.query('DELETE FROM slots');
        // Inserts every slot in one query. Postgres parses start/end here, so an
        // unparseable time fails the whole reset instead of storing bad data.
        await client.query(
          `INSERT INTO slots (id, provider, start_text, end_text, start_at, end_at)
           SELECT id, provider, start, "end", start::timestamptz, "end"::timestamptz
           FROM jsonb_to_recordset($1) AS s(id text, provider text, start text, "end" text)`,
          [JSON.stringify(slots)],
        );
      });
    } catch (err) {
      // 22007/22008: Postgres could not read a date-time.
      if (err.code === '22007' || err.code === '22008') {
        return res.status(400).json({ error: 'start and end must be ISO 8601 date-times' });
      }
      throw err;
    }

    res.json({ ok: true });
  });

  // Every slot, earliest start first, with available = false while it has a
  // confirmed booking.
  app.get('/slots', async (req, res) => {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
    const { rows } = await pool.query(
      `SELECT s.*,
              NOT EXISTS (
                SELECT 1 FROM bookings b
                WHERE b.slot_id = s.id AND b.status = 'confirmed'
              ) AS available
       FROM slots s
       WHERE $1::text IS NULL OR s.provider = $1
       ORDER BY s.start_at, s.id`,
      [provider],
    );
    res.json({ slots: rows.map((row) => ({ ...toSlot(row), available: row.available })) });
  });

  // An empty Idempotency-Key header is treated like no header.
  app.post('/bookings', async (req, res) => {
    const key = req.get('Idempotency-Key') || null;
    let result;
    try {
      result = await withTransaction((client) => (
        key === null ? attemptBooking(client, req.body) : createBookingOnce(client, key, req.body)
      ));
    } catch (err) {
      // 23503: the slot vanished after our lookup (a /reset ran in between).
      // With a key, the transaction rolled back, so nothing is saved for it.
      if (err.code === '23503') {
        return res.status(404).json({ error: 'slot not found' });
      }
      throw err;
    }
    if (result.retryAfter) {
      res.set('Retry-After', String(result.retryAfter));
    }
    res.status(result.status).json(result.body);
  });

  // One person's bookings, oldest first, a page at a time.
  app.get('/bookings', async (req, res) => {
    // Emails are stored trimmed and lower case, so this makes the match ignore case.
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    if (email === '') {
      return res.status(400).json({ error: 'email is required' });
    }

    let limit = 10;
    if (req.query.limit !== undefined) {
      // Whole numbers only, so "1.5", "-1" and "abc" are rejected.
      limit = /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : 0;
      if (limit < 1 || limit > 50) {
        return res.status(400).json({ error: 'limit must be a whole number from 1 to 50' });
      }
    }

    let afterSeq = '0';
    if (req.query.cursor !== undefined) {
      afterSeq = typeof req.query.cursor === 'string' ? decodeCursor(req.query.cursor) : null;
      if (afterSeq === null) {
        return res.status(400).json({ error: 'cursor is not valid' });
      }
    }

    // One row more than the page needs: if it comes back, there is a next page.
    const { rows } = await pool.query(
      `SELECT * FROM bookings
       WHERE email = $1 AND seq > $2
       ORDER BY seq
       LIMIT $3`,
      [email, afterSeq, limit + 1],
    );
    const page = rows.slice(0, limit);
    res.json({
      bookings: page.map(toBooking),
      next_cursor: rows.length > limit ? encodeCursor(page.at(-1).seq) : null,
    });
  });

  app.get('/bookings/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'booking not found' });
    }
    res.json(toBooking(rows[0]));
  });

  // Cancelling keeps the row and changes its status, so the booking can still be
  // looked up and the unique index stops counting it, which frees the slot.
  app.delete('/bookings/:id', async (req, res) => {
    // Only a confirmed booking changes, so if two cancels race, one of them wins.
    const { rows } = await pool.query(
      `UPDATE bookings SET status = 'cancelled'
       WHERE id = $1 AND status = 'confirmed'
       RETURNING *`,
      [req.params.id],
    );
    if (rows.length > 0) {
      return res.json(toBooking(rows[0]));
    }

    // Nothing changed: either there's no such booking or it was already cancelled.
    const existing = await pool.query('SELECT 1 FROM bookings WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'booking not found' });
    }
    res.status(409).json({ error: 'booking already cancelled' });
  });

  // Any path we don't handle. Without this Express answers with an HTML page,
  // but the spec says every error is {"error": "..."}.
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Express 5 sends errors thrown in async handlers here.
  app.use((err, req, res, next) => {
    // Problems reading the request body, such as malformed JSON.
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: 'invalid request body' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

// Vercel runs the app from this default export; locally server.js listens on a port.
export default createApp();

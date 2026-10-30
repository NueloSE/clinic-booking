import { randomUUID, timingSafeEqual } from 'node:crypto';
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

export function createApp() {
  if (!process.env.API_KEY) {
    throw new Error('API_KEY is not set');
  }
  const expectedKey = Buffer.from(process.env.API_KEY);

  const app = express();

  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

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

  app.post('/bookings', async (req, res) => {
    const { booking, error } = parseNewBooking(req.body);
    if (error) {
      return res.status(400).json({ error });
    }

    // The database's clock decides "started", so our server's clock can't be wrong.
    const slot = await pool.query(
      'SELECT start_at <= now() AS started FROM slots WHERE id = $1',
      [booking.slotId],
    );
    if (slot.rows.length === 0) {
      return res.status(404).json({ error: 'slot not found' });
    }
    if (slot.rows[0].started) {
      return res.status(400).json({ error: 'slot has already started' });
    }

    // No "is it booked?" check first: two requests could both pass it before
    // either inserts. We just insert and let the unique index reject the loser.
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO bookings (id, slot_id, name, email, status)
         VALUES ($1, $2, $3, $4, 'confirmed')
         RETURNING *`,
        [randomUUID(), booking.slotId, booking.name, booking.email],
      ));
    } catch (err) {
      // 23505: unique violation, someone already holds this slot.
      if (err.code === '23505' && err.constraint === 'one_confirmed_booking_per_slot') {
        return res.status(409).json({ error: 'slot already booked' });
      }
      // 23503: the slot vanished after our lookup (a /reset ran in between).
      if (err.code === '23503') {
        return res.status(404).json({ error: 'slot not found' });
      }
      throw err;
    }
    res.status(201).json(toBooking(rows[0]));
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

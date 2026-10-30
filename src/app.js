import { randomUUID } from 'node:crypto';
import express from 'express';
import { pool, withTransaction } from './db.js';

// Database rows use snake_case columns; these turn them into the JSON shapes in the spec.
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

export function createApp() {
  const app = express();
  app.use(express.json());

  // Health check for the host and the keep-alive pinger. Confirms the DB answers too.
  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

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
    const { slot_id, name, email } = req.body ?? {};
    const { rows } = await pool.query(
      `INSERT INTO bookings (id, slot_id, name, email, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING *`,
      [randomUUID(), slot_id, name, email],
    );
    res.status(201).json(toBooking(rows[0]));
  });

  app.get('/bookings/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'booking not found' });
    }
    res.json(toBooking(rows[0]));
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

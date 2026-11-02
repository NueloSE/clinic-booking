import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Node 20 tries each DNS address for only 250ms before giving up ("happy eyeballs").
// Over a slow link to the database every attempt can time out, so connect to one
// IPv4 address and let the normal TCP timeout apply instead.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
});

// An idle connection dropped by the server must not crash the process.
pool.on('error', (err) => {
  console.error('Idle database connection error:', err.message);
});

// Creates any missing tables. schema.sql only uses "IF NOT EXISTS", so this is
// safe on every start.
export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

// Runs fn inside a transaction and returns its result.
// Rolls back if fn throws, so a failed request never leaves half-written rows.
export async function withTransaction(fn) {
  const client = await pool.connect();
  // The pool only listens for errors on idle connections. If this one breaks
  // while we hold it, its 'error' event would crash the process with no
  // listener. The query in progress fails as well, so logging is enough.
  const onError = (err) => console.error('Database connection error:', err.message);
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // On a broken connection ROLLBACK fails too; keep the original error.
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.off('error', onError);
    client.release();
  }
}

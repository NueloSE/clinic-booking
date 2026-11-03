import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Node 20 gives each address only 250ms to connect, which a slow link to the
// database can exceed. Use one IPv4 address and the normal TCP timeout.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('Idle database connection error:', err.message);
});

// schema.sql only uses IF NOT EXISTS, so this is safe to run on every start.
export async function migrate() {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  // The pool only listens for errors on idle connections. Without this, a
  // connection dropped mid-transaction would crash the process.
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

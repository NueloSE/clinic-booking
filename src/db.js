import dns from 'node:dns';
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
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

// An idle connection dropped by the server must not crash the process.
pool.on('error', (err) => {
  console.error('Idle database connection error:', err.message);
});

// Runs fn inside a transaction and returns its result.
// Rolls back if fn throws, so a failed request never leaves half-written rows.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

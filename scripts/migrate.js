// Creates any missing tables. The local server does this on every start, but
// on Vercel nothing runs at startup, so run this once against the production
// database:
//
//   DATABASE_URL='postgresql://...' npm run migrate
//
// A DATABASE_URL set in the shell wins over the one in .env.

import { migrate, pool } from '../src/db.js';

await migrate();
await pool.end();
console.log('Tables are up to date.');

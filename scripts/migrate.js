// Creates the tables. Run once against the production database, since nothing
// runs at startup on Vercel:  DATABASE_URL='postgresql://...' npm run migrate

import { migrate, pool } from '../src/db.js';

await migrate();
await pool.end();
console.log('Tables are up to date.');

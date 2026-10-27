import express from 'express';
import { pool } from './db.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  // Health check for the host and the keep-alive pinger. Confirms the DB answers too.
  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  return app;
}

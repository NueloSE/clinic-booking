import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiServer = 'http://localhost:3000';

// The React app lives in web/ and is built into public/, which Vercel's CDN
// serves (and Express serves locally).
// During development, Vite forwards API calls to the Express server.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/slots': apiServer,
      '/bookings': apiServer,
    },
  },
});

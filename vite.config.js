import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiServer = 'http://localhost:3000';

// The React app lives in web/ and is built into dist/, which Express serves.
// During development, Vite forwards API calls to the Express server.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/slots': apiServer,
      '/bookings': apiServer,
    },
  },
});

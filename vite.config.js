import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiServer = 'http://localhost:3000';

// Builds web/ into public/. In development, API calls go to the Express server.
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

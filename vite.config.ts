import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.P_NOTE_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': api, '/__test': api, '/parties': { target: api, ws: true } },
  },
});

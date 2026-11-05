import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const webPoort = Number(process.env.STUDIO_WEB_POORT ?? 5480);
const api = `http://127.0.0.1:${process.env.STUDIO_API_POORT ?? 8480}`;

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPoort,
    strictPort: true,
    proxy: { '/api': api },
  },
  preview: { host: '127.0.0.1', port: webPoort, strictPort: true, proxy: { '/api': api } },
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
});

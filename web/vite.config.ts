import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5480,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8480' },
  },
  preview: { host: '127.0.0.1', port: 5480, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8480' } },
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
});

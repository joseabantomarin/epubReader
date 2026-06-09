import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Bypass the lucide-react barrel file in dev to avoid thousands of
      // individual module requests. Production tree-shaking is unaffected.
      'lucide-react': path.resolve(__dirname, '../node_modules/lucide-react/dist/esm/lucide-react.mjs'),
    },
  },
  server: {
    host: true,        // listen on 0.0.0.0 so LAN devices can reach it
    port: 5173,
    allowedHosts: ['.trycloudflare.com', 'localhost', '.local'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
});

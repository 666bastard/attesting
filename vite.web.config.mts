import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import * as path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/web/client',
  build: {
    // Must NOT overlap with tsc's dist/web/ output (which contains server.js,
    // routes/, middleware/, etc.). Previously set to dist/web/ with
    // emptyOutDir: true, which wiped the tsc output and broke CI.
    outDir: '../../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/web/client'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});

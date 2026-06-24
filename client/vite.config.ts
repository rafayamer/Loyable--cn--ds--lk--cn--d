import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    // No manual chunk splitting. Splitting interdependent vendor modules
    // (react / recharts / d3) into separate chunks creates circular chunk
    // references that surface as "Cannot access X before initialization"
    // (TDZ) errors at runtime and leave the page blank. Let Rollup decide.
  },
});

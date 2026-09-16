import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Hugo 同梱バイナリなどは監視しない (EBUSY 対策)
      ignored: ['**/resources/**', '**/release/**', '**/sample-site/**', '**/electron/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
});

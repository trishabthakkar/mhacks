import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the same build works at / and at /garden/ (set VITE_BASE to force an absolute base).
  base: process.env.VITE_BASE ?? './',
  // Allow importing ../shared (outside the Vite root).
  server: { fs: { allow: ['..'] } },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Big libraries in their own files so the app code can change without re-downloading them.
      output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules/spacetimedb') ? 'spacetimedb' : undefined) },
    },
  },
});

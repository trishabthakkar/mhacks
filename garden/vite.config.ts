import { defineConfig } from 'vite';

export default defineConfig({
  // Allow importing ../shared (outside the Vite root).
  server: { fs: { allow: ['..'] } },
});

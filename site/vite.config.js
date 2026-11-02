import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served as a GitHub Pages project site at https://sksiddhant.github.io/portfolio/
export default defineConfig({
  plugins: [react()],
  base: '/portfolio/',
  build: { outDir: 'dist', emptyOutDir: true },
});

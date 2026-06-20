import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

// Emit a 404.html identical to index.html so GitHub Pages serves the SPA for
// any deep link under the site (e.g. auth redirects with a path/hash).
function spaFallback() {
  return {
    name: 'spa-404',
    closeBundle() {
      const dir = resolve(__dirname, '../docs');
      copyFileSync(resolve(dir, 'index.html'), resolve(dir, '404.html'));
    },
  };
}

// Browser-only build of Portfolio Manager, published to GitHub Pages.
// Reuses the tested CSV/XLSX parsers and the P&L engine from ../src/lib,
// runs entirely client-side and persists data in the browser (localStorage).
export default defineConfig({
  root: __dirname,
  // GitHub Pages serves a project site under /<repo>/.
  base: '/Portfolio-Manager/',
  plugins: [react(), spaFallback()],
  define: {
    // The reused data912 client reads this; in the browser there is no
    // process.env, so inline it as a literal at build time.
    'process.env.DATA912_BASE_URL': JSON.stringify('https://data912.com'),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: resolve(__dirname, '../docs'),
    // The repo's docs/ also holds historical specs (docs/superpowers); don't
    // wipe them on build. We clean docs/assets ourselves before building.
    emptyOutDir: false,
  },
});

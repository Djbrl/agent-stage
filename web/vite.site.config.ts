// The public landing page: web/site → public/site (deployed to Vercel by scripts/public.sh).
// Only index.html and assets/ are written; live.json, vercel.json and the icons there stay.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dirname, '../public/site');
rmSync(join(out, 'assets'), { recursive: true, force: true }); // last build's hashed files
export default defineConfig({
  root: join(import.meta.dirname, 'site'),
  publicDir: false,
  plugins: [react()],
  build: { outDir: out, emptyOutDir: false },
});

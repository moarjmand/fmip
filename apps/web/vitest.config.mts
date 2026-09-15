import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The same `@/` the app compiles against, so a test can import a route module
  // (`app/robots.ts`, `app/sitemap.ts`) instead of asserting against its source.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The same `@/` the app compiles against, so a test can import a route module
  // (`app/robots.ts`, `app/sitemap.ts`) instead of asserting against its source.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Next compiles JSX with the automatic runtime and leaves `tsconfig.json` on
  // `preserve`; the transform would otherwise stop at the first component a
  // test imports (`translated.spec.ts`).
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});

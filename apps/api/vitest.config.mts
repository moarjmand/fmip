import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    root: import.meta.dirname,
  },
  plugins: [
    // Vitest transforms with esbuild, which supports `experimentalDecorators`
    // but never emits `emitDecoratorMetadata`. Without that metadata Nest's
    // dependency injection cannot resolve constructor parameters, so tests that
    // build a real module would fail where production code works. SWC emits it.
    swc.vite({ module: { type: 'es6' } }),
  ],
});

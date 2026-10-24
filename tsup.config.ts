import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Used by the app (ESM, Angular's builder) and by Jest (CommonJS).
    entry: { store: 'src/store/with-tracing.ts', jest: 'src/jest/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'es2022',
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
]);

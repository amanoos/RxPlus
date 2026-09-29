/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  plugins: [
    analog({
      // Only the public login page is static; everything else is private and SSR'd per request.
      prerender: { routes: ['/login'] },
      // Don't serve the client build's empty index.html as a static file: '/' must reach
      // the SSR renderer (and its auth guard). The renderer bundles its own copy.
      nitro: {
        ignore: ['*index.html'],
        // The weekly digest: Monday 6:00 AM in the server's time zone (TZ).
        experimental: { tasks: true },
        scheduledTasks: { '0 6 * * 1': ['digest:weekly'] },
      },
    }),
    tailwindcss(),
  ],
  test: {
    globals: true,
    reporters: ['default'],
    // npm run test:coverage (runs unit + integration; needs npm run db:test:up)
    coverage: {
      provider: 'v8',
      include: [
        'src/server/utils/**',
        'src/server/accounts/**',
        'src/app/core/auth/**',
        'src/app/store/**',
        'src/server/rxnorm/**',
        'src/server/medications/**',
        'src/app/features/medications/**',
        'src/server/interactions/**',
        'src/server/openfda/**',
        'src/app/features/interactions/**',
        'src/server/drug-info/**',
        'src/server/medlineplus/**',
        'src/app/features/drug-info/**',
        'src/server/ai/**',
        'src/server/pubmed/**',
        'src/server/ctgov/**',
        'src/server/literature/**',
        'src/app/features/literature/**',
        'src/server/alternatives/**',
        'src/app/features/alternatives/**',
        'src/server/digest/**',
        'src/app/features/digest/**',
        'src/server/costplus/**',
        'src/server/pricing/**',
        'src/app/features/pricing/**',
      ],
      exclude: ['**/*.spec.ts', '**/fixtures/**', '**/*.fixture.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['src/test-setup.ts'],
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts'],
        },
      },
      {
        // Needs the test database: npm run db:test:up
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.spec.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
}));

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

// Mirrors a React product's setup: `@` alias, globals, jest-dom and a named inline project that extends the root.
export default defineConfig({
  // import.meta.url is the long path; Windows os.tmpdir() is often the 8.3 form.
  root: fixtureRoot,
  // Isolated consumer runs set this so parallel pools do not share node_modules/.vite.
  ...(process.env.VITE_CACHE_DIR
    ? { cacheDir: process.env.VITE_CACHE_DIR }
    : {}),
  resolve: {
    alias: { '@': path.join(fixtureRoot, 'src') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'happy-dom-extended',
          environmentOptions: {
            happyDOM: { url: 'https://shop.example.test/dashboard' },
          },
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // import.meta.url is the long path; Windows os.tmpdir() is often the 8.3 form.
  root: fixtureRoot,
  // Isolated consumer runs set this so two fork workers do not share node_modules/.vite.
  ...(process.env.VITE_CACHE_DIR
    ? { cacheDir: process.env.VITE_CACHE_DIR }
    : {}),
  test: {
    environment: 'happy-dom-extended',
    setupFiles: ['./setup.mjs', './setup-after-env.mjs'],
    include: ['package.test.mjs', 'canvas.test.mjs', 'offscreen.test.mjs'],
  },
})

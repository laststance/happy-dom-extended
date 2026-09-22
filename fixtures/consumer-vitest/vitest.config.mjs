import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))
// Thread-pool runs load skia-canvas in the main thread first, as the README tells thread-pool users to.
const globalSetup = process.env.HAPPY_DOM_THREAD_POOL
  ? ['vitest-environment-happy-dom-extended/global-setup']
  : []

export default defineConfig({
  // import.meta.url is the long path; Windows os.tmpdir() is often the 8.3 form.
  root: fixtureRoot,
  // Isolated consumer runs set this so two fork workers do not share node_modules/.vite.
  ...(process.env.VITE_CACHE_DIR
    ? { cacheDir: process.env.VITE_CACHE_DIR }
    : {}),
  test: {
    environment: 'happy-dom-extended',
    globalSetup,
    setupFiles: ['./setup.mjs', './setup-after-env.mjs'],
    include: ['package.test.mjs', 'canvas.test.mjs', 'offscreen.test.mjs'],
  },
})

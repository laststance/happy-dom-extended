import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom-extended',
    setupFiles: ['./setup.mjs', './setup-after-env.mjs'],
    include: ['package.test.mjs', 'canvas.test.mjs', 'offscreen.test.mjs'],
  },
})

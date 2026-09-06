import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: true,
  deps: { alwaysBundle: ['@happy-dom-extended/compat'] },
})

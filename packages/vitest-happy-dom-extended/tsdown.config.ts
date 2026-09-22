import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: { eager: true },
    sourcemap: true,
    deps: { alwaysBundle: ['@happy-dom-extended/compat'] },
  },
  {
    // A separate build keeps the global setup self-contained, so index.mjs gains no shared chunk.
    entry: ['src/global-setup.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: { eager: true },
    sourcemap: true,
  },
  {
    entry: ['src/worker.ts'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    dts: false,
    sourcemap: true,
    deps: { alwaysBundle: ['@happy-dom-extended/compat'] },
  },
])

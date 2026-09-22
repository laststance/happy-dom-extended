import { defineConfig } from 'eslint/config'
import tsPrefixer from 'eslint-config-ts-prefixer'

export default defineConfig([
  ...tsPrefixer,
  { ignores: ['.artifacts/**', 'coverage/**'] },
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The product fixture resolves its own `@/*` alias; the root tsconfig excludes that fixture.
    files: ['fixtures/consumer-vitest-product/**'],
    settings: {
      'import-x/resolver': {
        node: {
          extensions: ['.mjs', '.js', '.cjs', '.mts', '.ts', '.jsx', '.tsx'],
        },
        typescript: {
          alwaysTryTypes: true,
          project: 'fixtures/consumer-vitest-product/tsconfig.json',
        },
      },
    },
  },
])

import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const environment = fileURLToPath(new URL('./dist/index.mjs', import.meta.url))
const packageRoot = 'packages/vitest-happy-dom-extended'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'forks',
          // Distinct groupOrder is required when projects use different maxWorkers.
          sequence: { groupOrder: 0 },
          environment,
          include: [`${packageRoot}/test/**/*.test.ts`],
          exclude: [
            `${packageRoot}/test/**/*.vm-threads.test.ts`,
            `${packageRoot}/test/isolate-false/**`,
          ],
        },
      },
      {
        test: {
          name: 'vmThreads',
          sequence: { groupOrder: 1 },
          pool: 'vmThreads',
          environment,
          include: [`${packageRoot}/test/**/*.vm-threads.test.ts`],
        },
      },
      {
        test: {
          name: 'isolate-false',
          sequence: { groupOrder: 2 },
          isolate: false,
          fileParallelism: false,
          pool: 'forks',
          maxWorkers: 1,
          environment,
          include: [`${packageRoot}/test/isolate-false/**/*.test.ts`],
        },
      },
    ],
  },
})

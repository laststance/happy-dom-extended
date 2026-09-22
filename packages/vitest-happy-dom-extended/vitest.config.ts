import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const environment = fileURLToPath(new URL('./dist/index.mjs', import.meta.url))
const packageRoot = 'packages/vitest-happy-dom-extended'

// Every supported pool runs the complete behavior suite; `forks` is Vitest's default.
const supportedPools = ['forks', 'threads', 'vmThreads', 'vmForks'] as const
// isolate:false only changes non-VM pools; VM pools always evaluate each file in a fresh context.
const sharedEnvironmentPools = ['forks', 'threads'] as const

/** Pins isolate:false files to path order so a-first always writes before b-second reads.
 * Vitest's default sequencer can reorder by size; isolate-false `sequence.sequencer` uses this.
 * @example sequence: { sequencer: IsolateFalseSequencer }
 */
class IsolateFalseSequencer {
  // Vitest constructs sequencers with the runner context; this project does not shard.
  constructor(_ctx: unknown) {}
  async shard<T>(files: T[]) {
    return files
  }
  async sort<T extends { moduleId: string }>(files: T[]) {
    return [...files].sort((left, right) =>
      left.moduleId.localeCompare(right.moduleId),
    )
  }
}

export default defineConfig({
  test: {
    projects: [
      ...supportedPools.map((pool) => ({
        test: {
          name: pool,
          pool,
          // Distinct groupOrder is required when projects use different maxWorkers.
          sequence: { groupOrder: 0 },
          environment,
          // test/pool.test.ts asserts the execution context this pool must provide.
          provide: { pool },
          include: [`${packageRoot}/test/**/*.test.ts`],
          exclude: [`${packageRoot}/test/isolate-false/**`],
        },
      })),
      ...sharedEnvironmentPools.map((pool) => ({
        test: {
          name: `isolate-false-${pool}`,
          pool,
          sequence: { groupOrder: 1, sequencer: IsolateFalseSequencer },
          isolate: false,
          fileParallelism: false,
          maxWorkers: 1,
          environment,
          include: [`${packageRoot}/test/isolate-false/**/*.test.ts`],
        },
      })),
    ],
  },
})

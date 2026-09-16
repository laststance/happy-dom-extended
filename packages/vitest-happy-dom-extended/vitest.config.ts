import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const environment = fileURLToPath(new URL('./dist/index.mjs', import.meta.url))
const packageRoot = 'packages/vitest-happy-dom-extended'

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
          sequence: { groupOrder: 2, sequencer: IsolateFalseSequencer },
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

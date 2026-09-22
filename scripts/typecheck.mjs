import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import compiler from 'typescript-compiler/package.json' with { type: 'json' }

// ESLint resolves TypeScript 6's supported JS API; this command runs the stable TypeScript 7 compiler.
const compilerEntry = fileURLToPath(
  new URL('../node_modules/typescript-compiler/bin/tsc', import.meta.url),
)
// The React product fixture needs JSX and bundler resolution, so it keeps its own project next to the root one.
const projects = [
  fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
  fileURLToPath(
    new URL(
      '../fixtures/consumer-vitest-product/tsconfig.json',
      import.meta.url,
    ),
  ),
]
process.stdout.write(`TypeScript ${compiler.version}\n`)
let failed = false
// Check every project so one run reports all type errors.
for (const project of projects) {
  const result = spawnSync(
    process.execPath,
    [compilerEntry, '--noEmit', '--project', project, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) failed = true
}
process.exitCode = failed ? 1 : 0

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import compiler from 'typescript-compiler/package.json' with { type: 'json' }

// ESLint resolves TypeScript 6's supported JS API; this command runs the stable TypeScript 7 compiler.
const compilerEntry = fileURLToPath(
  new URL('../node_modules/typescript-compiler/bin/tsc', import.meta.url),
)
process.stdout.write(`TypeScript ${compiler.version}\n`)
const result = spawnSync(
  process.execPath,
  [compilerEntry, '--noEmit', ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1

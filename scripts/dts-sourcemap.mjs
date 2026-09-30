/** Removes or checks for dangling `//# sourceMappingURL` comments in bundled
 * declaration files. tsdown 0.23 forwards `sourcemap: true` to declaration
 * output, appending the comment, while `dts.sourcemap` decides whether a map is
 * actually written — so published `.d.*` files reference maps the tarball does
 * not contain and editors resolve to a missing file.
 *
 * Called from each package's `build` (strip mode, default) and `check:package`
 * (`--check`) scripts.
 * @example node ../../scripts/dts-sourcemap.mjs        // strip in dist/
 * @example node ../../scripts/dts-sourcemap.mjs --check // fail if any remain
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const check = process.argv.includes('--check')
const dist = path.join(process.cwd(), 'dist')
const pattern = /\n?\/\/# sourceMappingURL=\S+\.d\.[cm]ts\.map\n?$/

const offenders = []
for (const name of readdirSync(dist)) {
  if (!/\.d\.[cm]ts$/.test(name)) continue
  const file = path.join(dist, name)
  const source = readFileSync(file, 'utf8')
  if (!pattern.test(source)) continue
  if (check) {
    offenders.push(name)
  } else {
    writeFileSync(file, source.replace(pattern, '\n'))
  }
}

if (check && offenders.length > 0) {
  console.error(
    `Dangling declaration-map references in ${dist}: ${offenders.join(', ')}`,
  )
  process.exitCode = 1
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const globalSetupUrl = new URL('../src/global-setup.ts', import.meta.url).href

/** Runs an ES module script in a fresh Node process, so the native libraries it reports were mapped by that script alone.
 * @param script - Module source that prints one JSON value.
 * @returns The parsed JSON the script printed; throws with the child's stderr when it fails.
 * @example runInFreshNode('console.log(JSON.stringify(1))') // => 1
 */
function runInFreshNode(script) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('importing the Vitest global setup entry loads no native binary until Vitest calls setup', () => {
  // Arrange
  const script = `
    import path from 'node:path'
    process.report.excludeNetwork = true
    await import(${JSON.stringify(globalSetupUrl)})
    const sharedObjects = process.report.getReport().sharedObjects
    console.log(JSON.stringify(sharedObjects.some((file) => path.basename(file) === 'skia.node')))
  `
  // Act
  const loadedSkiaBinary = runInFreshNode(script)
  // Assert
  assert.equal(loadedSkiaBinary, false)
})

test('the Vitest global setup keeps skia-canvas loaded in the main thread so Windows thread-pool workers cannot unload it', () => {
  // Arrange
  const script = `
    import path from 'node:path'
    process.report.excludeNetwork = true
    const { setup } = await import(${JSON.stringify(globalSetupUrl)})
    setup()
    const sharedObjects = process.report.getReport().sharedObjects
    console.log(JSON.stringify(sharedObjects.some((file) => path.basename(file) === 'skia.node')))
  `
  // Act
  const loadedSkiaBinary = runInFreshNode(script)
  // Assert
  assert.equal(loadedSkiaBinary, true)
})

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Environment, {
  createHappyDomExtendedEnvironment,
} from 'vitest-environment-happy-dom-extended'

assert.equal(typeof Environment.setup, 'function')
assert.equal(typeof Environment.setupVM, 'function')
assert.equal(Environment.name, 'happy-dom-extended')
assert.equal(typeof createHappyDomExtendedEnvironment, 'function')
const packageRequire = createRequire(
  import.meta.resolve('vitest-environment-happy-dom-extended/package.json'),
)
const happyDomEntry = packageRequire.resolve('happy-dom')
const environmentHappyDom = packageRequire('happy-dom')
assert.equal(
  environmentHappyDom.HTMLCanvasElement,
  (await import(pathToFileURL(happyDomEntry).href)).HTMLCanvasElement,
)
const dependencies = packageRequire('./package.json').dependencies
assert.equal(dependencies['skia-canvas'], '3.0.8')
assert.equal(dependencies.canvas, undefined)
assert.equal(dependencies['@happy-dom/node-canvas-adapter'], undefined)
assert.equal(dependencies.jest, undefined)
assert.equal(dependencies['@happy-dom/jest-environment'], undefined)
const packageDirectory = path.dirname(
  packageRequire.resolve('vitest-environment-happy-dom-extended/package.json'),
)
assert.equal(existsSync(path.join(packageDirectory, 'dist/worker.cjs')), true)
process.stdout.write('ESM package exports loaded successfully.\n')

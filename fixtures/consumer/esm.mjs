import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import Environment from 'jest-happy-dom-extended'

const require = createRequire(import.meta.url)
const CommonJSEnvironment = require('jest-happy-dom-extended')
assert.equal(typeof Environment, 'function')
assert.equal(typeof CommonJSEnvironment, 'function')
assert.equal(Environment, CommonJSEnvironment)
const removedCanvasEntry = 'jest-happy-dom-extended/canvas'
assert.throws(() => require(removedCanvasEntry), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
})
await assert.rejects(import(removedCanvasEntry), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
})
const packageRequire = createRequire(
  require.resolve('jest-happy-dom-extended/package.json'),
)
const environmentRequire = createRequire(
  packageRequire.resolve('@happy-dom/jest-environment'),
)
assert.equal(
  packageRequire('happy-dom').HTMLCanvasElement,
  environmentRequire('happy-dom').HTMLCanvasElement,
)
const dependencies = packageRequire('./package.json').dependencies
assert.equal(dependencies['skia-canvas'], '3.0.8')
assert.equal(dependencies.canvas, undefined)
assert.equal(dependencies['@happy-dom/node-canvas-adapter'], undefined)
process.stdout.write('ESM and CommonJS package exports loaded successfully.\n')

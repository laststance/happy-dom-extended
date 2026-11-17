import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toSkiaInstallError } from '../src/utils/skia-install-error.ts'

test('A missing skia-canvas binary explains how to reinstall optional platform packages', () => {
  // Arrange
  const missingBinary = Object.assign(
    new Error(
      "Cannot find module '../skia.node'\nRequire stack:\n- /project/node_modules/skia-canvas/lib/classes/neon.js",
    ),
    { code: 'MODULE_NOT_FOUND' },
  )
  // Act
  const reported = toSkiaInstallError(missingBinary)
  // Assert
  assert.ok(reported instanceof Error)
  assert.equal(
    reported.message,
    [
      'skia-canvas cannot load its native binary. Skia Canvas 4 requires the optional @skia-canvas package for this OS and architecture:',
      '  pnpm: pnpm install --force',
      '  npm:  npm install --include=optional',
      '  Bun:  bun install --force',
      'Keep optional dependencies enabled and reinstall on the target platform; do not copy node_modules between architectures. See https://skia-canvas.org/getting-started',
    ].join('\n'),
  )
  assert.equal(reported.cause, missingBinary)
})

test('A consumer without the skia-canvas package keeps the original resolution error', () => {
  // Arrange
  const missingPackage = Object.assign(
    new Error("Cannot find module 'skia-canvas'"),
    { code: 'MODULE_NOT_FOUND' },
  )
  // Act
  const reported = toSkiaInstallError(missingPackage)
  // Assert
  assert.equal(reported, missingPackage)
})

test('A skia-canvas binary built for another platform keeps the original loader error', () => {
  // Arrange
  const incompatibleBinary = Object.assign(
    new Error(
      "dlopen(/project/node_modules/skia-canvas/lib/skia.node, 0x0001): tried: '/project/node_modules/skia-canvas/lib/skia.node' (mach-o file, but is an incompatible architecture)",
    ),
    { code: 'ERR_DLOPEN_FAILED' },
  )
  // Act
  const reported = toSkiaInstallError(incompatibleBinary)
  // Assert
  assert.equal(reported, incompatibleBinary)
})

test('A non-object value thrown while loading skia-canvas is rethrown unchanged', () => {
  // Arrange
  const thrownValue = 'skia.node'
  // Act
  const reported = toSkiaInstallError(thrownValue)
  // Assert
  assert.equal(reported, thrownValue)
})

test('An omitted Skia 4 platform package receives installation guidance', () => {
  // Arrange
  const missingPackage = new Error(
    'Skia Canvas could not find a native binary for this platform (darwin-arm64).',
  )
  // Act
  const reported = toSkiaInstallError(missingPackage)
  // Assert
  assert.ok(reported instanceof Error)
  assert.equal(reported.cause, missingPackage)
  assert.equal(
    reported.message.includes('npm install --include=optional'),
    true,
  )
})

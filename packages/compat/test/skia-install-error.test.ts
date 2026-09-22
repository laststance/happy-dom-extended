import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toSkiaInstallError } from '../src/utils/skia-install-error.ts'

test('A skia-canvas install blocked by the package manager explains how to approve and rerun its install script', () => {
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
      'skia-canvas cannot load its native binary (lib/skia.node). Its install script downloads the binary, and pnpm, npm 12 and Bun skip that script until you approve it:',
      '  pnpm:   pnpm approve-builds   (select skia-canvas)',
      '  npm 12: npm approve-scripts skia-canvas && npm rebuild skia-canvas',
      '  Bun:    bun pm trust skia-canvas',
      'If the script ran but its download failed, rerun it with network access or build from source: https://skia-canvas.org/getting-started',
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

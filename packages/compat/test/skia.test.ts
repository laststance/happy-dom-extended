import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as esmSkiaCanvas from 'skia-canvas'

import { loadSkiaCanvas } from '../src/canvas/load-skia-canvas.ts'
import { Canvas, ImageData } from '../src/canvas/skia.ts'

test('Canvas modules share the exact skia-canvas classes that ESM consumers import', () => {
  // Act
  const loaded = loadSkiaCanvas()
  // Assert
  assert.equal(loaded.Canvas, esmSkiaCanvas.Canvas)
  assert.equal(Canvas, esmSkiaCanvas.Canvas)
  assert.equal(ImageData, esmSkiaCanvas.ImageData)
})

test('A blocked skia-canvas install fails environment loading with approval commands instead of MODULE_NOT_FOUND', () => {
  // Arrange
  const missingBinary = Object.assign(
    new Error("Cannot find module '../skia.node'"),
    { code: 'MODULE_NOT_FOUND' },
  )
  // Act / Assert
  assert.throws(
    () =>
      loadSkiaCanvas(() => {
        throw missingBinary
      }),
    (error) => {
      assert.ok(error instanceof Error)
      assert.equal(
        error.message.split('\n')[0],
        'skia-canvas cannot load its native binary (lib/skia.node). Its install script downloads the binary, and pnpm, npm 12 and Bun skip that script until you approve it:',
      )
      assert.equal(error.cause, missingBinary)
      return true
    },
  )
})

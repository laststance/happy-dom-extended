import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PNG } from 'pngjs'
import { FontLibrary } from 'skia-canvas'

import reference from '../../../fixtures/canvas/chrome-reference.json' with { type: 'json' }
import { renderCanvasCases } from '../../../fixtures/canvas/render-cases.mjs'

import { renderingWindow } from './utils/rendering-window.ts'

test('real renderer matches opaque browser pixels and stays within recorded edge, filter and Ahem tolerances', async (context) => {
  // Arrange
  const { window } = await renderingWindow(context)
  FontLibrary.use(
    'Ahem',
    fileURLToPath(
      new URL('../../../fixtures/canvas/Ahem.ttf', import.meta.url),
    ),
  )
  context.after(() => FontLibrary.reset())
  const limits = {
    opaque: [0, 0, 0],
    fractional: [48, 36, 3.3],
    curved: [48, 37, 4.4],
    blur: [14, 12, 2],
    brightness: [0, 0, 0],
    hueRotate: [0, 0, 0],
    dropShadow: [1, 1, 1],
    p3: [0, 0, 0],
    text: [37, 28.01, 4.9],
  } as const
  // Act
  const actual = renderCanvasCases(
    (width, height) => new window.OffscreenCanvas(width, height),
  )
  // Assert
  assert.deepEqual(Object.keys(actual), Object.keys(limits))
  for (const name of Object.keys(limits) as (keyof typeof limits)[]) {
    const observed = actual[name]!
    const pixels = Buffer.from(observed.rgba, 'base64')
    const expected = Buffer.from(reference.cases[name].rgba, 'base64')
    assert.equal(pixels.length, 1024)
    assert.equal(expected.length, 1024)
    let maxAlpha = 0
    let maxPremultiplied = 0
    let squaredError = 0
    // Compare premultiplied channels so invisible RGB bytes cannot inflate the rasterizer difference.
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3]!
      const referenceAlpha = expected[offset + 3]!
      maxAlpha = Math.max(maxAlpha, Math.abs(alpha - referenceAlpha))
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(
          (pixels[offset + channel]! * alpha) / 255 -
            (expected[offset + channel]! * referenceAlpha) / 255,
        )
        maxPremultiplied = Math.max(maxPremultiplied, difference)
        squaredError += difference ** 2
      }
    }
    const rms = Math.sqrt(squaredError / (16 * 16 * 3))
    context.diagnostic(
      JSON.stringify({ name, maxAlpha, maxPremultiplied, rms }),
    )
    assert.ok(maxAlpha <= limits[name][0], `${name}: alpha ${maxAlpha}`)
    assert.ok(
      maxPremultiplied <= limits[name][1],
      `${name}: premultiplied ${maxPremultiplied}`,
    )
    assert.ok(rms <= limits[name][2], `${name}: RMS ${rms}`)
    assert.equal(observed.textWidth, 20)
  }
})

for (const format of ['png', 'jpeg', 'webp'] as const)
  test(`${format.toUpperCase()} exports contain real pixels verified by an independent decoder`, async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const canvas = new window.OffscreenCanvas(16, 16)
    const drawing = canvas.getContext('2d')!
    drawing.fillStyle = '#2060c0'
    drawing.fillRect(0, 0, 16, 16)
    // Act
    const blob = await canvas.convertToBlob({
      type: `image/${format}`,
      quality: 1,
    })
    const encoded = Buffer.from(await blob.arrayBuffer())
    let pixels: Uint8Array
    if (format === 'png') {
      const decoded = PNG.sync.read(encoded)
      assert.equal(decoded.width, 16)
      assert.equal(decoded.height, 16)
      pixels = decoded.data
    } else {
      const decoded = spawnSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'pipe',
          '-i',
          'pipe:0',
          '-frames:v',
          '1',
          '-threads',
          '1',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgba',
          'pipe:1',
        ],
        {
          input: encoded,
          timeout: 30_000,
          maxBuffer: 64 * 1024,
        },
      )
      if (decoded.error) throw decoded.error
      assert.equal(decoded.status, 0, decoded.stderr.toString())
      pixels = decoded.stdout
    }
    // Assert
    assert.equal(blob.type, `image/${format}`)
    assert.equal(pixels.length, 1024)
    if (format === 'png')
      assert.equal(encoded.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    if (format === 'jpeg')
      assert.equal(encoded.subarray(0, 2).toString('hex'), 'ffd8')
    if (format === 'webp') {
      assert.equal(encoded.subarray(0, 4).toString(), 'RIFF')
      assert.equal(encoded.subarray(8, 12).toString(), 'WEBP')
    }
    const expected = [32, 96, 192, 255]
    for (let offset = 0; offset < pixels.length; offset += 1)
      assert.ok(
        Math.abs(pixels[offset]! - expected[offset % 4]!) <=
          (format === 'png' || offset % 4 === 3 ? 0 : 3),
        `${format}: channel ${offset} = ${pixels[offset]}`,
      )
  })

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { types } from 'node:util'

import fc from 'fast-check'
import { HTMLCanvasElement } from 'happy-dom'
import type { Blob, OffscreenCanvas } from 'happy-dom'
import { PNG } from 'pngjs'

import {
  MAX_BINARY_BYTES,
  MAX_CANVAS_SIDE_PX,
  MAX_CHANNEL_VALUE,
  MAX_PADDING_BYTES,
  MAX_RESIZE_STEPS,
  MAX_SLICE_BOUNDARY_BYTES,
  PROPERTY_PARAMETERS,
  PROPERTY_TIMEOUT_MS,
} from './constants.ts'
import { renderingWindow } from './utils/rendering-window.ts'

const dimensions = fc.record({
  width: fc.integer({ min: 1, max: MAX_CANVAS_SIDE_PX }),
  height: fc.integer({ min: 1, max: MAX_CANVAS_SIDE_PX }),
})
const opaqueColor = fc.tuple(
  fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
  fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
  fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
)

/** Observes either public asynchronous export without bypassing its Happy DOM task registration.
 * @param canvas - The generated HTML or Offscreen owner.
 * @returns Its encoded Blob, including null for an empty HTML canvas.
 * @example const pending = exportPNG(canvas); canvas.width = 0; await pending;
 */
async function exportPNG(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob | null> {
  return canvas instanceof HTMLCanvasElement
    ? new Promise((resolve) => canvas.toBlob(resolve))
    : canvas.convertToBlob()
}

test(
  'generated Blob and File parts preserve selected bytes, slices, independent copies, and FileReader data',
  { timeout: PROPERTY_TIMEOUT_MS },
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          bufferBytes: fc.uint8Array({ maxLength: MAX_BINARY_BYTES }),
          viewBytes: fc.uint8Array({ maxLength: MAX_BINARY_BYTES }),
          prefix: fc.uint8Array({ minLength: 1, maxLength: MAX_PADDING_BYTES }),
          suffix: fc.uint8Array({ minLength: 1, maxLength: MAX_PADDING_BYTES }),
          start: fc.integer({
            min: -MAX_SLICE_BOUNDARY_BYTES,
            max: MAX_SLICE_BOUNDARY_BYTES,
          }),
          end: fc.integer({
            min: -MAX_SLICE_BOUNDARY_BYTES,
            max: MAX_SLICE_BOUNDARY_BYTES,
          }),
        }),
        async ({ bufferBytes, viewBytes, prefix, suffix, start, end }) => {
          // Arrange: expected bytes come from generated inputs, never production conversions.
          const environment = await renderingWindow()
          const { window } = environment
          try {
            const padded = new window.Uint8Array([
              ...prefix,
              ...viewBytes,
              ...suffix,
            ])
            const selected = padded.subarray(
              prefix.length,
              prefix.length + viewBytes.length,
            )
            const nestedFile = new window.File([selected], 'view.bin')
            const nestedBlob = new window.Blob([
              new window.Uint8Array(bufferBytes).buffer,
              nestedFile,
              new window.Blob([]),
            ])
            const file = new window.File(
              [nestedBlob, new window.File([], 'empty.bin')],
              'nested.bin',
            )
            const expected = [...bufferBytes, ...viewBytes]

            // Act
            const slice = file.slice(start, end)
            const bytes: () => Promise<Uint8Array> = Reflect.get(
              file,
              'bytes',
            ).bind(file)
            const first = await bytes()
            const second = await bytes()
            first.fill(MAX_CHANNEL_VALUE)
            padded.fill(0)
            const reader = new window.FileReader()
            const read = new Promise<unknown>((resolve, reject) => {
              reader.addEventListener('load', () => resolve(reader.result), {
                once: true,
              })
              reader.addEventListener('error', () => reject(reader.error), {
                once: true,
              })
              reader.readAsArrayBuffer(file)
            })

            // Assert: surrounding bytes cannot leak, and later view edits cannot change the File.
            assert.equal(file.size, expected.length)
            assert.ok(file instanceof window.File)
            assert.ok(file instanceof window.Blob)
            assert.ok(slice instanceof window.Blob)
            assert.deepEqual(
              [...new Uint8Array(await file.arrayBuffer())],
              expected,
            )
            assert.deepEqual(
              [...new Uint8Array(await slice.arrayBuffer())],
              expected.slice(start, end),
            )
            assert.notEqual(first.buffer, second.buffer)
            assert.deepEqual([...second], expected)
            assert.deepEqual([...(await bytes())], expected)
            const result = await read
            assert.ok(types.isArrayBuffer(result))
            assert.deepEqual([...new Uint8Array(result)], expected)
            assert.equal(new window.Blob([]).size, 0)
          } finally {
            // fast-check calls this finally again for every failing shrink attempt.
            await environment.close()
          }
        },
      ),
      PROPERTY_PARAMETERS,
    )
  },
)

for (const kind of ['HTML', 'Offscreen'] as const) {
  test(
    `generated ${kind} dimension changes clear pixels and drawing state while retaining the context`,
    { timeout: PROPERTY_TIMEOUT_MS },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dimensions,
          opaqueColor,
          fc.array(
            fc.record({
              dimension: fc.constantFrom('width', 'height'),
              value: fc.integer({ min: 1, max: MAX_CANVAS_SIDE_PX }),
              method:
                kind === 'HTML'
                  ? fc.constantFrom('assign', 'same', 'attribute', 'remove')
                  : fc.constantFrom('assign', 'same'),
            }),
            { minLength: 1, maxLength: MAX_RESIZE_STEPS },
          ),
          async ({ width, height }, color, changes) => {
            // Arrange
            const environment = await renderingWindow()
            const { window } = environment
            const canvas =
              kind === 'HTML'
                ? window.document.createElement('canvas')
                : new window.OffscreenCanvas(width, height)
            try {
              Reflect.set(canvas, 'width', width)
              Reflect.set(canvas, 'height', height)
              const drawing = canvas.getContext('2d')!
              // Every generated sequence also exercises equal-value resets on both axes.
              for (const change of [
                { dimension: 'width', method: 'same', value: width },
                { dimension: 'height', method: 'same', value: height },
                ...changes,
              ]) {
                drawing.fillStyle = `rgb(${color.join(',')})`
                drawing.fillRect(0, 0, canvas.width, canvas.height)
                assert.deepEqual(
                  [...drawing.getImageData(0, 0, 1, 1).data],
                  [...color, 255],
                )
                drawing.translate(1, 1)
                drawing.globalAlpha = 0.5

                // Act
                const dimension =
                  change.dimension === 'width' ? 'width' : 'height'
                const value =
                  change.method === 'same' ? canvas[dimension] : change.value
                const expectedSize =
                  change.method === 'remove'
                    ? dimension === 'width'
                      ? 300
                      : 150
                    : value
                if (
                  canvas instanceof HTMLCanvasElement &&
                  change.method === 'attribute'
                ) {
                  canvas.setAttribute(dimension, String(value))
                } else if (
                  canvas instanceof HTMLCanvasElement &&
                  change.method === 'remove'
                ) {
                  // Ensure removal is a real mutation, even after an earlier generated removal.
                  canvas.setAttribute(dimension, String(value))
                  drawing.fillRect(0, 0, 1, 1)
                  canvas.removeAttribute(dimension)
                } else {
                  Reflect.set(canvas, dimension, value)
                }

                // Assert: the far corner proves the native bitmap adopted the DOM dimensions.
                assert.equal(canvas[dimension], expectedSize)
                assert.equal(canvas.getContext('2d'), drawing)
                assert.equal(drawing.canvas, canvas)
                assert.equal(drawing.fillStyle, '#000000')
                assert.equal(drawing.globalAlpha, 1)
                assert.deepEqual(
                  [...drawing.getImageData(0, 0, 1, 1).data],
                  [0, 0, 0, 0],
                )
                drawing.fillRect(canvas.width - 1, canvas.height - 1, 1, 1)
                assert.deepEqual(
                  [
                    ...drawing.getImageData(
                      canvas.width - 1,
                      canvas.height - 1,
                      1,
                      1,
                    ).data,
                  ],
                  [0, 0, 0, 255],
                )
                // Attribute defaults stay bounded to one axis before the next generated change.
                Reflect.set(canvas, 'width', width)
                Reflect.set(canvas, 'height', height)
              }
            } finally {
              await environment.close()
            }
          },
        ),
        PROPERTY_PARAMETERS,
      )
    },
  )

  test(
    `generated ${kind} PNG exports preserve invocation pixels through redraw, resize, completion, and cleanup`,
    { timeout: PROPERTY_TIMEOUT_MS },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dimensions,
          fc.uniqueArray(opaqueColor, {
            minLength: 2,
            maxLength: 2,
            selector: (color) => color.join(','),
          }),
          async ({ width, height }, colors) => {
            // Arrange
            const environment = await renderingWindow()
            const { window } = environment
            const canvas =
              kind === 'HTML'
                ? window.document.createElement('canvas')
                : new window.OffscreenCanvas(width, height)
            try {
              Reflect.set(canvas, 'width', width)
              Reflect.set(canvas, 'height', height)
              const drawing = canvas.getContext('2d')!
              const completed: number[] = []
              const outputs: Promise<Blob | null>[] = []

              // Act: each pending encoder must own its call-time image before subsequent drawing.
              for (const [index, color] of colors.entries()) {
                drawing.fillStyle = `rgb(${color.join(',')})`
                drawing.fillRect(0, 0, width, height)
                outputs.push(
                  exportPNG(canvas).then((blob) => {
                    completed.push(index)
                    return blob
                  }),
                )
              }
              Reflect.set(canvas, 'width', 0)
              await window.happyDOM.waitUntilComplete()

              // Assert: waiting for Happy DOM alone must have delivered both exports.
              assert.deepEqual(completed.toSorted(), [0, 1])
              for (const [index, pending] of outputs.entries()) {
                const blob = await pending
                assert.ok(blob instanceof window.Blob)
                assert.equal(blob.type, 'image/png')
                const decoded = PNG.sync.read(
                  Buffer.from(await blob.arrayBuffer()),
                )
                assert.equal(decoded.width, width)
                assert.equal(decoded.height, height)
                assert.deepEqual(
                  [...decoded.data],
                  Array.from({ length: width * height }, () => [
                    ...colors[index]!,
                    255,
                  ]).flat(),
                )
              }

              // Runner teardown drains owned output too, without relying on a consumer awaiting it.
              Reflect.set(canvas, 'width', width)
              drawing.fillStyle = `rgb(${colors[0]!.join(',')})`
              drawing.fillRect(0, 0, width, height)
              let delivered = false
              const finalOutput = exportPNG(canvas).then((blob) => {
                delivered = true
                return blob
              })
              await environment.close()
              assert.equal(delivered, true)
              const finalBlob = await finalOutput
              assert.ok(finalBlob)
              const decoded = PNG.sync.read(
                Buffer.from(await finalBlob.arrayBuffer()),
              )
              assert.deepEqual(
                [...decoded.data],
                Array.from({ length: width * height }, () => [
                  ...colors[0]!,
                  255,
                ]).flat(),
              )
            } finally {
              await environment.close()
            }
          },
        ),
        PROPERTY_PARAMETERS,
      )
    },
  )

  test(
    `generated ${kind} zero dimensions follow the empty export contract`,
    { timeout: PROPERTY_TIMEOUT_MS },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          dimensions,
          fc.constantFrom('width', 'height'),
          async ({ width, height }, dimension) => {
            // Arrange
            const environment = await renderingWindow()
            const { window } = environment
            const canvas =
              kind === 'HTML'
                ? window.document.createElement('canvas')
                : new window.OffscreenCanvas(width, height)
            try {
              Reflect.set(canvas, 'width', width)
              Reflect.set(canvas, 'height', height)
              canvas.getContext('2d')!.fillRect(0, 0, width, height)
              // Act / Assert
              Reflect.set(canvas, dimension, 0)
              if (canvas instanceof HTMLCanvasElement) {
                assert.equal(canvas.toDataURL(), 'data:,')
                let synchronous = true
                let synchronousCallback = true
                const output = new Promise<Blob | null>((resolve) =>
                  canvas.toBlob((blob) => {
                    synchronousCallback = synchronous
                    resolve(blob)
                  }),
                )
                synchronous = false
                await window.happyDOM.waitUntilComplete()
                assert.equal(await output, null)
                assert.equal(synchronousCallback, false)
              } else {
                await assert.rejects(canvas.convertToBlob(), {
                  name: 'IndexSizeError',
                })
              }
            } finally {
              await environment.close()
            }
          },
        ),
        PROPERTY_PARAMETERS,
      )
    },
  )
}

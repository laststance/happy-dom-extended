import { expect, test } from '@jest/globals'
import fc from 'fast-check'

import {
  MAX_CANVAS_SIDE_PX,
  MAX_CHANNEL_VALUE,
  MAX_PADDING_BYTES,
  PROPERTY_PARAMETERS,
  PROPERTY_TIMEOUT_MS,
  RGBA_CHANNELS,
} from '../../compat/test/constants.ts'

for (const storage of ['ArrayBuffer', 'SharedArrayBuffer'] as const) {
  test(
    `generated Jest VM ImageData retains ${storage} subviews and draws mutations at their original offset`,
    () => {
      fc.assert(
        fc.property(
          fc
            .record({
              width: fc.integer({ min: 1, max: MAX_CANVAS_SIDE_PX }),
              height: fc.integer({ min: 1, max: MAX_CANVAS_SIDE_PX }),
              prefixLength: fc.integer({ min: 1, max: MAX_PADDING_BYTES }),
              suffixLength: fc.integer({ min: 1, max: MAX_PADDING_BYTES }),
            })
            .chain((shape) =>
              fc.record({
                shape: fc.constant(shape),
                colors: fc.array(
                  fc.tuple(
                    fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
                    fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
                    fc.integer({ min: 0, max: MAX_CHANNEL_VALUE }),
                  ),
                  {
                    minLength: shape.width * shape.height,
                    maxLength: shape.width * shape.height,
                  },
                ),
                changedPixel: fc.integer({
                  min: 0,
                  max: shape.width * shape.height - 1,
                }),
              }),
            ),
          ({
            shape: { width, height, prefixLength, suffixLength },
            colors,
            changedPixel,
          }) => {
            // Arrange: these constructors execute inside the actual Jest test VM.
            const expected = colors.flatMap((color) => [...color, 255])
            const byteLength = prefixLength + expected.length + suffixLength
            const buffer =
              storage === 'SharedArrayBuffer'
                ? new SharedArrayBuffer(byteLength)
                : new ArrayBuffer(byteLength)
            const backing = new Uint8ClampedArray(buffer).fill(42)
            const pixels = new Uint8ClampedArray(
              buffer,
              prefixLength,
              expected.length,
            )
            pixels.set(expected)
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            try {
              const drawing = canvas.getContext('2d')!
              // Act: mutation through ImageData and through its backing view must be shared.
              // DOM typings omit shared storage; construct the actual Window implementation unchanged.
              const image: ImageData = Reflect.construct(ImageData, [
                pixels,
                width,
                height,
              ])
              const changedIndex = changedPixel * RGBA_CHANNELS
              expected[changedIndex] =
                MAX_CHANNEL_VALUE - expected[changedIndex]!
              image.data[changedIndex] = expected[changedIndex]!
              expected[changedIndex + 1] =
                MAX_CHANNEL_VALUE - expected[changedIndex + 1]!
              backing[prefixLength + changedIndex + 1] =
                expected[changedIndex + 1]!
              drawing.putImageData(image, 0, 0)
              const output = drawing.getImageData(0, 0, width, height)

              // Assert
              expect(image).toBeInstanceOf(ImageData)
              expect(image.data).toBe(pixels)
              expect(image.data.buffer).toBe(buffer)
              expect(image.data.byteOffset).toBe(prefixLength)
              expect(image.width).toBe(width)
              expect(image.height).toBe(height)
              expect([...image.data]).toEqual(expected)
              expect([...backing.subarray(0, prefixLength)]).toEqual(
                Array(prefixLength).fill(42),
              )
              expect([
                ...backing.subarray(prefixLength + expected.length),
              ]).toEqual(Array(suffixLength).fill(42))
              expect(output).toBeInstanceOf(ImageData)
              expect(output.data).toBeInstanceOf(Uint8ClampedArray)
              expect([...output.data]).toEqual(expected)
              expect(drawing.createImageData(width, height)).toBeInstanceOf(
                ImageData,
              )
            } finally {
              // Each case and shrink releases its native bitmap before the next allocation.
              canvas.width = 0
              canvas.height = 0
              canvas.remove()
            }
          },
        ),
        PROPERTY_PARAMETERS,
      )
    },
    PROPERTY_TIMEOUT_MS,
  )
}

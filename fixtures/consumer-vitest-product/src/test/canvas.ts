/** Reads one RGBA pixel from a rendered canvas, the way a product test checks what a chart drew.
 * @param element - Canvas found through an accessible query.
 * @param x - Horizontal pixel coordinate.
 * @param y - Vertical pixel coordinate.
 * @returns The pixel as `[red, green, blue, alpha]`; throws when the element is not a 2D canvas.
 * @example readPixel(screen.getByRole('img', { name: 'Monthly sales' }), 0, 0) // => [0, 128, 0, 255]
 */
export function readPixel(element: HTMLElement, x: number, y: number) {
  const context =
    element instanceof HTMLCanvasElement ? element.getContext('2d') : null
  if (!context) throw new TypeError('Expected a canvas with a 2D context.')
  return [...context.getImageData(x, y, 1, 1).data]
}

/** Draws a solid PNG file, like an image a user picks from disk.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param color - CSS color for every pixel.
 * @returns A `File` named `avatar.png` with type `image/png`.
 * @example await createPngFile(3, 2, 'rgb(255, 0, 0)') // => File { name: 'avatar.png' }
 */
export async function createPngFile(
  width: number,
  height: number,
  color: string,
) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new TypeError('OffscreenCanvas has no 2D context.')
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  const png = await canvas.convertToBlob({ type: 'image/png' })
  return new File([png], 'avatar.png', { type: 'image/png' })
}

/** Decodes an image URL and reads one of its pixels, like previewing a downloaded export.
 * @param url - Blob or data URL of the image.
 * @param x - Horizontal pixel coordinate.
 * @param y - Vertical pixel coordinate.
 * @returns The pixel as `[red, green, blue, alpha]`.
 * @example await readImagePixel(link.href, 0, 0) // => [0, 0, 255, 255]
 */
export async function readImagePixel(url: string, x: number, y: number) {
  const image = new Image()
  image.src = url
  await image.decode()
  const canvas = new OffscreenCanvas(1, 1)
  const context = canvas.getContext('2d')
  if (!context) throw new TypeError('OffscreenCanvas has no 2D context.')
  context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1)
  return [...context.getImageData(0, 0, 1, 1).data]
}

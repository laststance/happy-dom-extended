/** Runs identical small drawings in the browser and owned Canvas to separate API behavior from rasterizer differences.
 * @param {(width: number, height: number) => {width: number, height: number, getContext(type: '2d'): import('happy-dom').ICanvasRenderingContext2D | null}} createCanvas - Environment's real Canvas constructor.
 * @returns Named base64 RGBA samples and text measurements, without encoder differences.
 * @example renderCanvasCases((width, height) => new window.OffscreenCanvas(width, height)).text.textWidth; // 20
 */
export function renderCanvasCases(createCanvas) {
  /** @type {Record<string, (context: import('happy-dom').ICanvasRenderingContext2D) => void>} */
  const cases = {
    opaque: (context) => context.fillRect(2, 2, 8, 8),
    fractional: (context) => context.fillRect(2.25, 2.25, 7.5, 7.5),
    curved: (context) => {
      context.beginPath()
      context.arc(8, 8, 5, 0, Math.PI * 2)
      context.fill()
    },
    blur: (context) => {
      context.filter = 'blur(1px)'
      context.fillRect(5, 5, 5, 5)
    },
    brightness: (context) => {
      context.filter = 'brightness(150%)'
      context.fillRect(2, 2, 8, 8)
    },
    hueRotate: (context) => {
      context.filter = 'hue-rotate(90deg)'
      context.fillRect(2, 2, 8, 8)
    },
    dropShadow: (context) => {
      context.filter = 'drop-shadow(2px 2px 1px red)'
      context.fillStyle = 'blue'
      context.fillRect(2, 2, 6, 6)
    },
    p3: (context) => {
      context.fillStyle = 'color(display-p3 1 0 0)'
      context.fillRect(2, 2, 8, 8)
    },
    text: (context) => context.fillText('A', 2, 12),
  }
  return Object.fromEntries(
    Object.entries(cases).map(([name, draw]) => {
      const canvas = createCanvas(16, 16)
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('A real 2D context is required.')
        context.fillStyle = '#4080c0'
        context.font = '10px Ahem'
        draw(context)
        return [
          name,
          {
            rgba: btoa(
              String.fromCharCode(...context.getImageData(0, 0, 16, 16).data),
            ),
            textWidth: context.measureText('AA').width,
          },
        ]
      } finally {
        // Release each renderer's backing surface before the next independent drawing.
        canvas.width = 0
        canvas.height = 0
      }
    }),
  )
}

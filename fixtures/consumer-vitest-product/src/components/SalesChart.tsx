import { useEffect, useRef, useState } from 'react'

type SalesChartProps = {
  monthlySales: readonly number[]
  barColor: string
}

/** Dashboard widget that draws monthly sales as bars and exports the chart as a PNG download.
 * Plain Happy DOM has no 2D context, so this widget only works in tests with a real Canvas backend.
 * @param props - Sales per month, oldest first, and the CSS bar color.
 * @returns The chart canvas, an export button and, after exporting, a download link.
 * @example <SalesChart monthlySales={[50, 100]} barColor="rgb(0, 128, 0)" />
 */
export function SalesChart({ monthlySales, barColor }: SalesChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const barWidth = canvas.width / monthlySales.length
    const highestSales = Math.max(...monthlySales)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = barColor
    // Bars grow upward from the bottom edge, scaled to the best month.
    monthlySales.forEach((sales, month) => {
      const barHeight = (sales / highestSales) * canvas.height
      context.fillRect(
        month * barWidth,
        canvas.height - barHeight,
        barWidth,
        barHeight,
      )
    })
  }, [monthlySales, barColor])

  // Release the previous export when a newer one replaces it or the chart unmounts.
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    },
    [downloadUrl],
  )

  function exportPng() {
    canvasRef.current?.toBlob((png) => {
      if (png) setDownloadUrl(URL.createObjectURL(png))
    }, 'image/png')
  }

  return (
    <figure>
      <canvas
        ref={canvasRef}
        width={40}
        height={20}
        role="img"
        aria-label="Monthly sales"
      />
      <button type="button" onClick={exportPng}>
        Export PNG
      </button>
      {downloadUrl ? (
        <a href={downloadUrl} download="sales.png">
          Download sales.png
        </a>
      ) : null}
    </figure>
  )
}

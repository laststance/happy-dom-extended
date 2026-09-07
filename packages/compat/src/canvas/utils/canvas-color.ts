import { formatRgb, parse } from 'culori'

/** Converts CSS Color 4 input into the renderer's supported sRGB color syntax for styles and gradient stops.
 * @returns A normalized color, or undefined when an assignment should be ignored.
 * @example canvasColor('color(display-p3 1 0 0)'); // rgb(255, 0, 0)
 */
export function canvasColor(value: string): string | undefined {
  const color = parse(value)
  return color && formatRgb(color)
}

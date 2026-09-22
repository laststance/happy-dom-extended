// skia-canvas's install script downloads lib/skia.node; pnpm, npm 12 and Bun skip dependency scripts until approved.
const SKIA_INSTALL_GUIDANCE = [
  'skia-canvas cannot load its native binary (lib/skia.node). Its install script downloads the binary, and pnpm, npm 12 and Bun skip that script until you approve it:',
  '  pnpm:   pnpm approve-builds   (select skia-canvas)',
  '  npm 12: npm approve-scripts skia-canvas && npm rebuild skia-canvas',
  '  Bun:    bun pm trust skia-canvas',
  'If the script ran but its download failed, rerun it with network access or build from source: https://skia-canvas.org/getting-started',
].join('\n')

/** Turns skia-canvas's missing-binary MODULE_NOT_FOUND into approval commands; the Canvas loader throws the result.
 * Without it, every test file fails with a bare `Cannot find module '../skia.node'` and no hint about the blocked install script.
 * @param error - Failure thrown while requiring skia-canvas.
 * @returns
 * - An Error with install guidance and the original failure as `cause` when lib/skia.node is missing
 * - The original failure unchanged otherwise, such as a missing package or a binary built for another platform
 * @example
 * toSkiaInstallError(Object.assign(new Error("Cannot find module '../skia.node'"), { code: 'MODULE_NOT_FOUND' })).message // => 'skia-canvas cannot load its native binary (lib/skia.node). …'
 * toSkiaInstallError(new TypeError('boom')) // => the same TypeError
 */
export function toSkiaInstallError(error: unknown): unknown {
  const isMissingBinary =
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'MODULE_NOT_FOUND' &&
    String(Reflect.get(error, 'message')).includes('skia.node')
  return isMissingBinary
    ? new Error(SKIA_INSTALL_GUIDANCE, { cause: error })
    : error
}

// Skia 4 distributes native binaries as optional platform packages rather than install-script downloads.
const SKIA_INSTALL_GUIDANCE = [
  'skia-canvas cannot load its native binary. Skia Canvas 4 requires the optional @skia-canvas package for this OS and architecture:',
  '  pnpm: pnpm install --force',
  '  npm:  npm install --include=optional',
  '  Bun:  bun install --force',
  'Keep optional dependencies enabled and reinstall on the target platform; do not copy node_modules between architectures. See https://skia-canvas.org/getting-started',
].join('\n')

/** Turns skia-canvas's missing native binaries into reinstall commands; the Canvas loader throws the result.
 * Without it, every test file fails with a bare `Cannot find module '../skia.node'` and no hint about the missing optional platform package.
 * @param error - Failure thrown while requiring skia-canvas.
 * @returns
 * - An Error with install guidance and the original failure as `cause` when the platform binary is missing
 * - The original failure unchanged otherwise, such as a missing package or a binary built for another platform
 * @example
 * toSkiaInstallError(Object.assign(new Error("Cannot find module '../skia.node'"), { code: 'MODULE_NOT_FOUND' })).message // => 'skia-canvas cannot load its native binary. …'
 * toSkiaInstallError(new TypeError('boom')) // => the same TypeError
 */
export function toSkiaInstallError(error: unknown): unknown {
  const isMissingBinary =
    typeof error === 'object' &&
    error !== null &&
    ((Reflect.get(error, 'code') === 'MODULE_NOT_FOUND' &&
      String(Reflect.get(error, 'message')).includes('skia.node')) ||
      String(Reflect.get(error, 'message')).startsWith(
        'Skia Canvas could not find a native binary for this platform',
      ))
  return isMissingBinary
    ? new Error(SKIA_INSTALL_GUIDANCE, { cause: error })
    : error
}

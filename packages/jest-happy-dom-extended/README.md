# jest-happy-dom-extended

**Run browser JavaScript tests in Node.js with a Happy DOM Jest environment, real 2D Canvas rendering and additional working Web APIs.**

## Installation

Requires **Node.js >=22.18.0** and **Jest 30**. Choose your package manager below.

`skia-canvas` is a required dependency. Its installation script downloads the native binary for your platform. See the [Skia installation guide](https://skia-canvas.org/getting-started) for supported Linux, Windows and macOS builds and source-build requirements.

### npm

```sh
npm install --save-dev jest@30 jest-happy-dom-extended
```

With npm 12, [approve](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) and run Skia's native installation script after installation:

```sh
npm approve-scripts skia-canvas
npm rebuild skia-canvas
```

### pnpm

```sh
pnpm add -D jest@30 jest-happy-dom-extended
pnpm approve-builds skia-canvas @parcel/watcher unrs-resolver
```

pnpm 11 and 12 stop `pnpm add` with `ERR_PNPM_IGNORED_BUILDS` until these install scripts are approved. The packages are already added, so run the `pnpm approve-builds` line next. It saves the approvals under `allowBuilds` in `pnpm-workspace.yaml` and runs the scripts. Jest 30 installs **@parcel/watcher** and **unrs-resolver**; Skia needs **skia-canvas**.

pnpm 10 finishes `pnpm add` with an "Ignored build scripts" warning and no Skia binary. Its `pnpm approve-builds` ignores package names and opens a prompt: select the same packages there. See [pnpm approve-builds](https://pnpm.io/cli/approve-builds).

For a non-interactive installation, merge this into `pnpm-workspace.yaml` before running `pnpm add`:

```yaml
allowBuilds:
  skia-canvas: true
  '@parcel/watcher': true
  unrs-resolver: true
```

pnpm 10 uses a `pnpm.onlyBuiltDependencies` list in `package.json` instead when one exists, so add `skia-canvas` to that list. pnpm 11 and 12 read only `allowBuilds`.

### Bun

```sh
bun add --dev jest@30 jest-happy-dom-extended
bun pm trust skia-canvas
```

[`bun pm trust`](https://bun.sh/docs/pm/cli/pm#trust) runs Skia's installation script and saves the package in `trustedDependencies`. Use Bun to install dependencies; run Jest with Node.js as shown below.

### Video support

**Drawing video frames also requires `ffmpeg` and `ffprobe` on PATH.** Ordinary Canvas drawing and image loading do not use these executables. Supported video formats depend on your FFmpeg build.

## Configure Jest

Select the installed package as your Jest environment:

```js
// jest.config.mjs
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: { url: 'https://example.test/' },
}
```

```sh
npx jest
```

Use `module.exports` in `jest.config.cjs` for CommonJS. Extensions are installed synchronously before `setupFiles` and `setupFilesAfterEnv`; existing transforms and application fixtures remain normal Jest configuration.

## Included behavior

Happy DOM provides the DOM, fetch and related browser object families. This package extends its official Jest environment and normalizes verified differences across Jest's VM boundary.

| API                               | Extension                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML Canvas / OffscreenCanvas     | CPU Skia 2D drawing, paths, filters, compositing, PNG/JPEG/WebP output, dimension/state resets and call-time asynchronous snapshots         |
| ImageData                         | Window-compatible types, shared VM pixel arrays/subviews, sRGB/display-p3 byte conversion                                                   |
| Images and createImageBitmap      | Intrinsic dimensions, invocation-time readiness, Blob/ImageData/Canvas/video sources, crop/resize/flip and real Bitmap storage              |
| Canvas security                   | Image/video CORS, redirect/credential handling, taint propagation and protected readback/export                                             |
| Canvas transport / Worker         | ImageBitmap cloning/transfer and context-free OffscreenCanvas transfer, HTML placeholder presentation and actual dedicated Worker execution |
| structuredClone                   | Native graph cloning and ArrayBuffer transfer, extended for owned Canvas/Bitmap payloads                                                    |
| Encoding / compression streams    | Node-backed TextEncoderStream, TextDecoderStream, CompressionStream and DecompressionStream                                                 |
| MessageChannel / MessagePort      | Native entangled ports with matching constructor identity and owned-resource cleanup                                                        |
| BroadcastChannel                  | Native delivery isolated to the test environment                                                                                            |
| Blob / File                       | VM binary normalization, FileReader compatibility, bytes() and BOM-aware UTF-8 text()                                                       |
| Animation.cancel()                | Observable AbortError rejection without an internal unhandled rejection                                                                     |
| XMLHttpRequest / CompositionEvent | Instance ready-state constants and composed text with normal event flags                                                                    |

Application-specific mocks remain in your tests. The [Canvas contract](https://github.com/laststance/happy-dom-extended/blob/main/docs/canvas-compatibility.md) documents supported behavior, resource limits and measured browser differences.

## Real Canvas output

Save this as `canvas.test.cjs`; it runs with the configuration above without a TypeScript transform.

```js
const { expect, test } = require('@jest/globals')

test('draws a red pixel and exports PNG', async () => {
  // Arrange
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  // Act
  context.fillStyle = 'red'
  context.fillRect(0, 0, 1, 1)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve))
  // Assert
  expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(blob?.type).toBe('image/png')
})
```

OffscreenCanvas provides the same drawing with `await canvas.convertToBlob()`. Reassigning a dimension, including the same value or a dimension attribute, clears pixels and drawing state while preserving an already obtained context's identity. Unsupported output MIME types fall back to real PNG bytes with the matching MIME type.

Asynchronous outputs copy pixels at invocation. Later redraws or resizes cannot change the pending image. Happy DOM's `waitUntilComplete()` includes these outputs, and teardown drains the environment's own outputs without waiting for unrelated application intervals. Encoding failures produce an asynchronous null HTML toBlob result or an Offscreen EncodingError rejection. Empty HTML canvases produce data:, or asynchronous null; empty Offscreen exports reject with IndexSizeError. Tainted readback/export fails with SecurityError. Cleanup still runs when a user callback throws.

## Configuration and lifecycle

Image loading is enabled by default. Opt out explicitly when needed:

```js
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: {
    settings: { enableImageFileLoading: false },
  },
}
```

Standard Happy DOM environment options pass through. Jest serializes configuration for its workers, so construct custom Canvas adapter instances programmatically in a custom environment subclass before `super()`, or when constructing the environment directly. Custom adapters preserve their identity and remain their owner's cleanup responsibility. An explicit `canvasAdapter: null` keeps rendering disabled.

ESM imports and CommonJS require share one runtime, coordinating prototype restoration across simultaneous environments. The package owns the Canvas/media/Worker resources it creates. Close ports transferred out to other owners when those owners finish. Setup code that opens native resources must clean them up if it throws: Jest 30.5.1 can skip environment teardown after a failing setupFiles module.

## Runtime boundaries

- Runtime dependencies are pinned to Happy DOM 20.14.0 and CPU skia-canvas 3.0.8. CI covers Node 22.18.0, 24.20.0 and 26.8.1 on Linux/Windows, plus installed Jest 30.0.0 and 30.5.1 consumers in serial and two-process modes.
- Canvas contexts use effective sRGB/unorm8 backing. Byte ImageData supports sRGB/display-p3 conversion; float16 ImageData is not supported. Font availability, edge rasterization and decoder rounding can differ from browsers.
- 2D support does not include a Window Path2D constructor, WebGL, WebGPU or bitmaprenderer. Real layout and browser scheduling require a browser.
- Dedicated Workers use actual node:worker_threads and the documented classic/module script loader. They are for trusted test code; their VM contexts are not a security sandbox. Node/file imports, service/shared workers and arbitrary browser-platform serialization are outside the supported contract.
- Video selects the latest frame at or before the requested timestamp and samples playback at up to 20 fps. Audio playback and browser media scheduling are outside the contract.
- Native structuredClone does not make every Happy DOM Blob, File, DOM node or platform object cloneable. BroadcastChannel names are isolated per test environment.
- Animation support addresses cancellation promises; other upstream animation limitations remain.

Read the [exact Canvas limits and evidence](https://github.com/laststance/happy-dom-extended/blob/main/docs/canvas-compatibility.md), [verification guide](https://github.com/laststance/happy-dom-extended/blob/main/docs/verification.md) and [architecture](https://github.com/laststance/happy-dom-extended/blob/main/ARCHITECTURE.md) for details. The former `/canvas` helper subpath is removed; use the environment setting above.

## Troubleshooting

**`skia-canvas cannot load its native binary (lib/skia.node)`** means the package manager skipped Skia's install script. The error lists the approval commands for pnpm, npm 12 and Bun, and keeps the original loader error as its `cause`. Approve and run the script as described in [Installation](#installation), then rerun Jest. Version 0.2.0 reports the same problem as `Cannot find module '../skia.node'`.

When the install script ran but its download failed, rerun it with network access or build Skia from source with the [Skia installation guide](https://skia-canvas.org/getting-started).

## Contributing and releases

The [monorepo](https://github.com/laststance/happy-dom-extended) contains source, regression/property tests and installed-consumer fixtures. `pnpm check` validates the implementation and its distribution. The private compatibility workspace is bundled; consumers install only this public package and its normal dependencies. Follow the [contribution guide](https://github.com/laststance/happy-dom-extended/blob/main/CONTRIBUTING.md) or [release guide](https://github.com/laststance/happy-dom-extended/blob/main/docs/releasing.md).

Independent Laststance project; not an official Happy DOM or Jest package. MIT licensed.

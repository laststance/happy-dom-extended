[![Test](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml)
[![Build](https://github.com/laststance/happy-dom-extended/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/build.yml)
[![Lint](https://github.com/laststance/happy-dom-extended/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/lint.yml)
[![Fallow](https://github.com/laststance/happy-dom-extended/actions/workflows/fallow.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/fallow.yml)
[![Security](https://github.com/laststance/happy-dom-extended/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/security.yml)
[![Socket](https://github.com/laststance/happy-dom-extended/actions/workflows/socket.yml/badge.svg?branch=main)](https://github.com/laststance/happy-dom-extended/actions/workflows/socket.yml)
[![Codecov](https://codecov.io/gh/laststance/happy-dom-extended/branch/main/graph/badge.svg)](https://codecov.io/gh/laststance/happy-dom-extended)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

# happy-dom-extended

**Jest and Vitest environments for running browser JavaScript tests in Node.js with Happy DOM, real 2D Canvas rendering, and additional working Web APIs.**

## Installation

Requires **Node.js >=22.18.0** and **Jest 30** or **Vitest 4**. Choose your package manager below.

`skia-canvas` is a required dependency. Its installation script downloads the native binary for your platform. See the [Skia installation guide](https://skia-canvas.org/getting-started) for supported Linux, Windows and macOS builds and source-build requirements.

### npm

```sh
npm install --save-dev jest@30 jest-happy-dom-extended
# or
npm install --save-dev vitest@4 vitest-environment-happy-dom-extended
```

With npm 12, [approve](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) and run Skia's native installation script after installation:

```sh
npm approve-scripts skia-canvas
npm rebuild skia-canvas
```

### pnpm

```sh
pnpm add -D jest@30 jest-happy-dom-extended
# or
pnpm add -D vitest@4 vitest-environment-happy-dom-extended
pnpm approve-builds
```

In the approval prompt, select **skia-canvas** and your project's other required native scripts. Jest 30 also lists **@parcel/watcher** and **unrs-resolver**. [pnpm saves these approvals](https://pnpm.io/cli/approve-builds) in `pnpm-workspace.yaml`.

For a non-interactive installation with pnpm 12, merge this into `pnpm-workspace.yaml` before running `pnpm add`:

```yaml
allowBuilds:
  skia-canvas: true
  '@parcel/watcher': true
  unrs-resolver: true
```

### Bun

```sh
bun add --dev jest@30 jest-happy-dom-extended
# or
bun add --dev vitest@4 vitest-environment-happy-dom-extended
bun pm trust skia-canvas
```

[`bun pm trust`](https://bun.sh/docs/pm/cli/pm#trust) runs Skia's installation script and saves the package in `trustedDependencies`. Use Bun to install dependencies; run Jest with Node.js as shown below.

### Video support

**Drawing video frames also requires `ffmpeg` and `ffprobe` on PATH.** Ordinary Canvas drawing and image loading do not use these executables. Supported video formats depend on your FFmpeg build.

## Configure Jest or Vitest

Select the installed package as your test environment:

```js
// jest.config.mjs
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: { url: 'https://example.test/' },
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom-extended',
    environmentOptions: { happyDOM: { url: 'https://example.test/' } },
  },
})
```

```sh
npx jest
npx vitest run
```

CommonJS Jest projects can put the same configuration object in `jest.config.cjs` with `module.exports`. Your existing transforms, test files and application fixtures continue to use normal runner configuration. Jest extensions are available before `setupFiles` and `setupFilesAfterEnv` run. Vitest resolves `environment: 'happy-dom-extended'` to `vitest-environment-happy-dom-extended`. The default Vitest pool is `forks`; `vmForks` is not claimed in 0.1.0.

## What this library provides

Happy DOM supplies the DOM and browser object families. The public packages add missing Node-backed APIs, repair verified compatibility gaps across the runner boundary, and own the Canvas behavior listed below. One environment setting supplies these capabilities to every test file. The [Jest package guide](packages/jest-happy-dom-extended/README.md) and [Vitest package guide](packages/vitest-happy-dom-extended/README.md) cover runner-specific configuration.

| Capability                    | Included behavior                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML Canvas / OffscreenCanvas | Real CPU Skia 2D drawing, paths, filters, compositing, PNG/JPEG/WebP output, attribute-driven dimension resets and asynchronous output snapshots                                |
| ImageData and image sources   | Window-compatible pixel arrays, preserved subarray/shared storage, sRGB/display-p3 byte conversion, intrinsic image dimensions, invocation-time readiness and createImageBitmap |
| Cross-origin media            | Image/video CORS and redirect checks, credentials, origin taint, protected readback/export and request cancellation                                                             |
| Bitmap transport and Workers  | ImageBitmap cloning/transfer and context-free OffscreenCanvas transfer, HTML placeholder presentation, MessageChannel and actual dedicated worker_threads execution             |
| Video Canvas sources          | Actual decoded frames, seeking and clock-driven playback when ffmpeg/ffprobe are installed                                                                                      |
| Blob / File                   | Binary VM inputs, FileReader compatibility, UTF-8 BOM handling and bytes()                                                                                                      |
| Streams and messaging         | Encoding/compression streams, native structuredClone, MessagePort and environment-isolated BroadcastChannel                                                                     |
| Events, animation and XHR     | CompositionEvent text, observable animation cancellation rejection and XHR instance constants                                                                                   |

Application-specific mocks and fixtures stay in your tests. Real browsers remain necessary for layout, WebGL/WebGPU, browser-specific scheduling and exact browser rendering. The [Canvas compatibility contract](docs/canvas-compatibility.md) records precise supported APIs, limits and comparison evidence.

## Draw and inspect real pixels

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

OffscreenCanvas offers the same 2D drawing with `await canvas.convertToBlob()` for output. Asynchronous exports preserve the pixels present when requested, including when a test immediately redraws or resizes. Environment teardown drains its own pending exports and releases owned media, ports and Workers.

Image loading is enabled by default. Disable it with Happy DOM `settings.enableImageFileLoading: false`. Custom Canvas adapters can still be supplied programmatically; ownership remains with the caller. No extra Canvas setup import is required.

## Compatibility and verification

The runtime pair is pinned to **Happy DOM 20.14.0**, and the renderer is **skia-canvas 3.0.8** in CPU mode. CI tests Node **22.18.0, 24.20.0 and 26.8.1** on **Linux and Windows**, including installed consumers using Jest **30.0.0 and 30.5.1** and Vitest **4.0.0 plus the current pin**, serial execution and two worker processes.

The tests check real pixels and encoded images, actual HTTP/decoder/Worker cancellation, ownership transfer, failure recovery and teardown. Shared browser fixtures measure renderer-dependent differences with explicit tolerances. This is selected conformance evidence, not a complete Web Platform Tests run. See [verification](docs/verification.md) and the [Canvas contract](docs/canvas-compatibility.md).

## Contribute and release

Start with [CONTRIBUTING.md](CONTRIBUTING.md), [TESTING.md](TESTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Public behavior changes need an observable regression and a [Changeset](.changeset/README.md).

```sh
pnpm install --frozen-lockfile
pnpm check
```

Use the pnpm version pinned in the root package manifest. `pnpm check` runs source/Jest/Vitest tests with coverage, lint, format, types, Sherif, Fallow, package export/type checks and isolated tarball consumers. After Test succeeds on `main`, [Release](.github/workflows/release.yml) opens a Version Packages PR or publishes with OIDC. [docs/releasing.md](docs/releasing.md) covers that workflow and the local pack/inspect fallback. Tracked follow-ups live in [TODOS.md](TODOS.md).

Workflows are separated into [Test](.github/workflows/test.yml), [Lint](.github/workflows/lint.yml), [Format](.github/workflows/format.yml), [TypeCheck](.github/workflows/typecheck.yml), [Build](.github/workflows/build.yml), [Fallow](.github/workflows/fallow.yml), [Security](.github/workflows/security.yml), [Socket](.github/workflows/socket.yml), [OpenSSF Scorecard](.github/workflows/scorecard.yml) and [Release](.github/workflows/release.yml). Security includes CodeQL, dependency review and a production dependency audit. Codecov receives the Linux Node 24 coverage report.

Socket scans same-repository PRs, pushes to main, its weekly schedule and manual runs, using the `SOCKET_SECURITY_API_TOKEN` Actions secret. Fork PRs skip that secret-dependent workflow. See [Socket token setup](https://docs.socket.dev/docs/create-socket-api-key-for-cicd) for maintainer configuration.

| Workspace                          | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| packages/jest-happy-dom-extended   | Public Jest environment (`jest-happy-dom-extended`)                 |
| packages/vitest-happy-dom-extended | Public Vitest environment (`vitest-environment-happy-dom-extended`) |
| packages/compat                    | Private implementation bundled into both public packages            |

This is an independent [Laststance](https://github.com/laststance) project. It is not an official Happy DOM, Jest, or Vitest package. Report vulnerabilities through [SECURITY.md](SECURITY.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).

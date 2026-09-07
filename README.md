# happy-dom-extended

[![CI](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml/badge.svg)](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml)
[![Codecov](https://codecov.io/gh/laststance/happy-dom-extended/branch/main/graph/badge.svg)](https://codecov.io/gh/laststance/happy-dom-extended)
[![Security](https://github.com/laststance/happy-dom-extended/actions/workflows/security.yml/badge.svg)](https://github.com/laststance/happy-dom-extended/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Run browser application tests in Node.js with Happy DOM, additional Web APIs, and real Canvas drawing.**

Happy DOM supplies the DOM for your Jest tests. `jest-happy-dom-extended` builds on its official Jest environment to fill verified Web API gaps, normalize values crossing Jest's VM boundary, and provide native 2D Canvas rendering. Select one test environment instead of maintaining the same environment patches in every application's setup file.

Canvas output contains the pixels your application drew. HTML Canvas and OffscreenCanvas support PNG output, ImageData, resizing, and asynchronous completion. JPEG output requires native JPEG support; when unavailable, JPEG requests produce PNG with an `image/png` MIME type. Application-specific mocks still belong in your tests. This project does not claim full browser equivalence; use a real browser for layout, WebGL, Worker execution, and browser-specific rendering checks.

## Install

Requires **Node.js >=22.18.0** and **Jest 30**. CI tests Node **22.18.0, 24.20.0, and 26.8.1** on Linux and Windows, with both Jest 30.0.0 and 30.5.1 installed-package consumers.

The package is **not yet published to npm**. To try the current implementation, build a tarball locally:

```sh
git clone https://github.com/laststance/happy-dom-extended.git
cd happy-dom-extended
pnpm install --frozen-lockfile
pnpm build
mkdir -p artifacts
pnpm --filter jest-happy-dom-extended pack --pack-destination ../../artifacts

# Run in your application, using the actual tarball path produced above:
pnpm add -D /absolute/path/to/happy-dom-extended/artifacts/jest-happy-dom-extended-0.1.0.tgz
```

Use the pnpm version pinned in `package.json` (12.3.4). See [pnpm installation](https://pnpm.io/installation) if it is not installed. After the first npm release, the installation command will be:

```sh
pnpm add -D jest-happy-dom-extended
```

`canvas` is a required native dependency. Approve its build when your package manager requests it. For pnpm 12, merge this entry into your application's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  canvas: true
```

Other pnpm versions use their corresponding build approval settings. Prebuilt binaries cover common macOS, Linux glibc x64, and Windows x64 systems. Source builds need Cairo/Pango and platform build tools; see [native installation](packages/jest-happy-dom-extended/README.md#native-installation).

## Configure Jest

```js
// jest.config.mjs
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: {
    url: 'https://example.test/',
  },
}
```

For CommonJS, use the same object with `module.exports` in `jest.config.cjs`. Existing transforms, test matching, application fixtures, and setup files remain ordinary Jest configuration. Extensions are ready before `setupFiles` and `setupFilesAfterEnv` run.

Remove setup patches for the APIs this package supplies after validating your application tests. Keep application-specific mocks and fixtures. No `/canvas` import is required; that former stub entry has been removed.

## Draw and inspect real pixels

```ts
import { expect, test } from '@jest/globals'

test('draws a red pixel and exports PNG', async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')!
  context.fillStyle = 'red'
  context.fillRect(0, 0, 1, 1)

  expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve),
  )
  expect(blob?.type).toBe('image/png')
})
```

OffscreenCanvas works the same way, with `await canvas.convertToBlob()` for output. Asynchronous exports keep the pixels from the moment you request them, even if your code immediately draws again or resizes. Teardown waits for this environment's pending exports and releases its resources.

## What is included?

| Capability                    | Behavior                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTML Canvas / OffscreenCanvas | Real native 2D drawing, PNG/JPEG output (JPEG falls back to `image/png` without its native codec), dimension/state resets, correct context owner |
| ImageData                     | Preserves VM pixel arrays, shared storage, and subarray offsets; Canvas results use the Window's types                                           |
| Blob / File                   | Handles binary VM inputs, UTF-8 BOM decoding, and `bytes()` while preserving FileReader compatibility                                            |
| Streams / cloning             | Node-backed encoding and compression streams and `structuredClone`                                                                               |
| Messaging                     | Native MessageChannel/MessagePort and environment-isolated BroadcastChannel, with owned-resource cleanup                                         |
| Events / animation / XHR      | CompositionEvent text, observable cancellation rejection, and XHR instance constants                                                             |

Existing Happy DOM fetch, DOM events, and related object families stay compatible with each other. See the [package guide](packages/jest-happy-dom-extended/README.md) for API details, configuration, custom adapter ownership, native requirements, and limitations.

Image loading is enabled by default; opt out with `testEnvironmentOptions.settings.enableImageFileLoading: false`. Font metrics, anti-aliasing, codecs, complete WebIDL validation, and origin-clean/CORS behavior can differ from browsers. The package supplies verified extensions rather than a complete browser engine.

## Contribute

Bug reports, minimal reproductions, documentation improvements, and compatibility fixes are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [TESTING.md](TESTING.md). Changes to public behavior need an observable regression test and a [Changeset](.changeset/README.md).

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs build, tests with coverage, types, ESLint, Prettier, Sherif, Fallow health/dupes/dead-code, npm export/type checks, and isolated tarball consumers. Coverage is emitted to `coverage/lcov.info` and `coverage/coverage-final.json`; CI uploads the Linux Node 24 report to Codecov. Test and packaging checks run across all six Node/OS combinations.

Workflows are separated into [Test](.github/workflows/test.yml), [Lint](.github/workflows/lint.yml), [Format](.github/workflows/format.yml), [TypeCheck](.github/workflows/typecheck.yml), [Build](.github/workflows/build.yml), [Fallow](.github/workflows/fallow.yml), [Security](.github/workflows/security.yml), [Socket](.github/workflows/socket.yml), and [OpenSSF Scorecard](.github/workflows/scorecard.yml). Security includes CodeQL, dependency review, and a production dependency audit. Actions are pinned to commits; write permissions are limited to security reporting. CI validates packages and does not publish to npm.

Socket scans dependency manifests and lockfiles on same-repository PRs, pushes to `main`, a weekly schedule, and manual runs. Its pinned CLI runs without installing workspace dependencies and fails when the scan violates the Socket organization's policy. Maintainers must add `SOCKET_SECURITY_API_TOKEN` to repository or organization Actions secrets; see [Socket API token setup](https://docs.socket.dev/docs/create-socket-api-key-for-cicd). A missing token fails with a configuration error. Fork PRs skip this workflow because GitHub does not expose the token to them; the existing dependency review still runs.

## Repository and project status

| Workspace                            | Purpose                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `packages/jest-happy-dom-extended`   | Public Jest environment; currently preparing its first npm release       |
| `packages/compat`                    | Private runner-independent implementation, bundled into the Jest package |
| `packages/vitest-happy-dom-extended` | Reserved for the next phase; no usable Vitest environment yet            |

The baseline is Happy DOM 20.14.0 with canvas 3.2.3. [Research](docs/research/2026-09-06-web-api-compatibility.md) records sources and reproduced gaps; [Canvas research](docs/research/canvas-rendering.md) explains the adapter corrections; [verification](docs/verification.md) separates local evidence from CI. [ARCHITECTURE.md](ARCHITECTURE.md) explains ownership and lifecycle decisions.

This is an independent [Laststance](https://github.com/laststance) project. It is not an official Happy DOM or Jest package. Report vulnerabilities using [SECURITY.md](SECURITY.md), and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE).

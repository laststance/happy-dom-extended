# Verification

The current implementation owns Canvas semantics around CPU skia-canvas 3.0.8, including real image/video sources, origin-clean checks, ImageData color conversion, Bitmap transport and dedicated Workers. The runtime baseline is pinned Happy DOM 20.14.0, Jest 30.5.1 and Vitest 5.0.1. The official node-canvas adapter remains a development-only interoperability fixture. Installed consumers also check Jest 30.0.0/30.5.1 and Vitest 4.0.0, 4.1.11 and 5.0.1.

## Local evidence

The full local gate ran on macOS arm64 with Node.js 24.19.0, pnpm 12.3.4 and npm 12.0.2. Source integration used Jest 30.5.1 and Vitest 5.0.1. Installed consumers used Jest 30.0.0 and 30.5.1 plus Vitest 4.0.0, 4.1.11 and 5.0.1, installed by npm 12.0.2 after their generated manifests approved Skia's install script. `pnpm test:package` also passed with Node.js 26.10.0, which defines Node's own Web Storage globals by default. Test output, not a zero process exit alone, determines completion.

| Layer                                 | Expected successful execution                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node source regressions               | 233 tests, including the Vitest entry loader, the Web Storage override, the thread-pool global setup and the skia-canvas install guidance                                                                |
| Jest integration                      | 20 tests in 4 suites                                                                                                                                                                                     |
| Vitest integration                    | 100 tests in 24 files: the same 24 tests in 5 files for each of `forks`, `threads`, `vmThreads` and `vmForks`, plus `isolate: false` files in `forks` and `threads`                                      |
| Installed consumer per Jest version   | 11 lifecycle tests; 10 Jest tests in 3 suites in serial mode; the same 10 tests with two worker processes                                                                                                |
| Installed consumer per Vitest version | 7 lifecycle tests; 11 Vitest tests in 3 files with one `forks` worker and with two workers in every pool; 8 React product tests in 4 files in every pool; `threads` and `vmThreads` use the global setup |
| Node Web Storage                      | Below Node 25, Vitest runs add `--experimental-webstorage`. Tests must receive the Window's `localStorage` and `sessionStorage`, and Node 25+ runs must not print Node's `localStorage` warning          |
| Missing native binary                 | The development Jest and Vitest versions fail with every approval command after the Skia binary is hidden, and so does the Vitest global setup before any worker starts                                  |
| Public entry points                   | Jest shared ESM/CommonJS runtime; Vitest ESM-only environment and global setup; consistent Happy DOM class identity; removed `/canvas` rejected; no `vitest/environments` warning on Vitest 4.1 or 5     |

`pnpm test` reported 99.32% source line coverage. `pnpm test:package` took under two minutes for all eight installed consumers on Node.js 24 and on Node.js 26.

The isolated tarball is installed outside this checkout in a dedicated temp directory (prefixes have no spaces; `os.tmpdir()` itself may). Native install scripts are enabled. Launchers pass executable paths as argv, not a shell string, and resolve Windows 8.3 temp paths before spawning Vitest. The fixture does not install Canvas directly. PNG is independently decoded using pngjs; JPEG/WebP are decoded by FFmpeg and compared with documented tolerance. The private Worker bootstrap executes from the installed package, including Blob-based scripts. Setup records verify each pool's process, thread and VM context, and runner JSON reports verify every expected suite and test.

Source tests cover actual red/blue/transparent pixels, Window ImageData types, same-value and attribute dimension resets, resized source canvases, image output before context creation, snapshot preservation during redraw/resize, Happy DOM waiting, callback and encoder failures, frozen configuration, and teardown with unrelated intervals. Mixed ESM/CommonJS environments retain Canvas and Blob behavior regardless of creation/closing order. Cleanup failures preserve the original error and attempt remaining restorations.

## Installation behavior

The README's pnpm instructions come from clean consumers on macOS arm64 with Node.js 24.19.0. Each consumer installed skia-canvas 3.0.8 directly, the Vitest tarball, or jest-happy-dom-extended 0.2.0.

| pnpm    | Unapproved `pnpm add`                                                      | Approval that installed the Skia binary                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10.33.4 | Exit 0 with an "Ignored build scripts" warning; no binary                  | Interactive `pnpm approve-builds`, which ignores package names; `allowBuilds` or `onlyBuiltDependencies` in `pnpm-workspace.yaml`; `pnpm.onlyBuiltDependencies` in `package.json` when that list exists |
| 11.1.2  | `ERR_PNPM_IGNORED_BUILDS`; writes `skia-canvas: set this to true or false` | `pnpm approve-builds skia-canvas`; `allowBuilds` in `pnpm-workspace.yaml`                                                                                                                               |
| 12.4.2  | `ERR_PNPM_IGNORED_BUILDS`; writes `skia-canvas: set this to true or false` | `pnpm approve-builds skia-canvas`; `allowBuilds` in `pnpm-workspace.yaml`                                                                                                                               |

pnpm 10.33.4 gave a `pnpm.onlyBuiltDependencies` list in `package.json` precedence over both workspace settings. pnpm 11.1.2 and 12.4.2 ignored that field, and they did not build Skia from `onlyBuiltDependencies` in `pnpm-workspace.yaml`. Jest 30 consumers also listed @parcel/watcher and unrs-resolver. The README Vitest example then passed with Vitest 5.0.1 in `forks`, `threads`, `vmThreads` and `vmForks`.

## Real application trials

These runs installed the packed Vitest tarball into disposable copies of two public Laststance applications, using the procedure in [TESTING.md](../TESTING.md#try-an-application-before-release). Each run was compared with Vitest's plain `happy-dom` environment.

| Application                                                   | Vitest | Pools compared                | Result with happy-dom-extended                                                   |
| ------------------------------------------------------------- | ------ | ----------------------------- | -------------------------------------------------------------------------------- |
| [laststance/corelive](https://github.com/laststance/corelive) | 5.0.0  | `forks`, `threads`            | 879 passed and 20 skipped of 899 tests, the same as `happy-dom`                  |
| [laststance/corelive](https://github.com/laststance/corelive) | 5.0.0  | `vmThreads`, `vmForks`        | One failure, identical with `happy-dom`: the test deletes `globalThis.navigator` |
| [laststance/corelive](https://github.com/laststance/corelive) | 5.0.0  | Every pool on Node.js 26.10.0 | The same results as on Node.js 24.19.0; `forks` matched `happy-dom`              |
| [laststance/gitbox](https://github.com/laststance/gitbox)     | 4.1.11 | `forks`, `threads`            | 959 of 959 unit tests passed; no `vitest/environments` warning                   |
| [laststance/gitbox](https://github.com/laststance/gitbox)     | 4.1.11 | `vmThreads`, `vmForks`        | Two failures, identical with `happy-dom`: a `dispatchEvent` spy count            |
| [laststance/gitbox](https://github.com/laststance/gitbox)     | 4.1.11 | `forks` on Node.js 26.10.0    | 959 of 959 unit tests passed, the same as `happy-dom`                            |

Rows without a Node.js version ran on Node.js 24.19.0. The corelive `forks` suite took 11.24 seconds with this environment and 10.61 seconds with `happy-dom`.

corelive's setup file installs its own Happy DOM storage because Node's Web Storage globals shadowed the Window's. With that workaround removed, corelive still passed 879 tests on Node.js 26.10.0, and on Node.js 24.19.0 with `--experimental-webstorage`. gitbox replaces `localStorage` with its own mock in a setup file, so its Node.js 26 result does not depend on the Web Storage override. Its one Node `localStorage` warning came from @code-inspector/core loading in Vitest's main process, outside the test environment, with either environment.

corelive is not written for `isolate: false` and failed 32 to 162 tests there with both environments. One gitbox `isolate: false` run with this environment had two order-dependent `vi.mock` failures, and three further runs per environment passed. One corelive `--no-isolate` run with this environment hung at full CPU for over ten minutes. Seven further attempts, including an exact replay, did not reproduce it, and no environment-specific cause was found.

## Windows thread-pool crash

A Windows CI run of `pnpm test:package` once exited with code 3221225477 (`0xC0000005`, an access violation) after a Vitest thread pool's tests had passed. Temporary experiments on GitHub's Windows runners then repeated the installed consumer's `threads` and `vmThreads` runs with Vitest 4.0.0 and 5.0.1 on Node.js 24.20.0. A second experiment started 300 worker threads that each loaded skia-canvas, encoded a PNG and exited.

| Condition                                                                         | Runs                   | Crashes       |
| --------------------------------------------------------------------------------- | ---------------------- | ------------- |
| Vitest thread pools, skia-canvas loaded only in workers                           | 800                    | 20            |
| Vitest thread pools, a global setup loads skia-canvas in the main thread          | 160                    | 0             |
| 300 worker threads on Node.js 24.20.0 and on 26.8.1, skia-canvas only in them     | 5 attempts per version | 2 per version |
| 300 worker threads on Node.js 22.18.0, skia-canvas only in them                   | 5 attempts             | 0             |
| 300 worker threads on Node.js 24.20.0, skia-canvas also loaded in the main thread | 5 attempts             | 0             |

Crashes occurred with and without `--experimental-webstorage`, and with skia-canvas's synchronous encoder in place of the asynchronous one. A crash dump showed the processor executing code inside skia.node after Windows had unloaded it. skia-canvas's thread-pool threads were still parked in that module. Node releases a worker thread's handle to a native addon when the thread exits. Windows unloads the addon when no handle remains, and a handle the main thread opened lasts until the process ends. The Vitest package therefore provides `vitest-environment-happy-dom-extended/global-setup`, and the installed consumers use it for `threads` and `vmThreads`.

## Reproduce the complete gate

```sh
pnpm install --frozen-lockfile
pnpm check
```

This runs Sherif, Prettier, documentation link resolution, build, Node, Jest, and Vitest tests with c8 coverage, ESLint, TypeScript, Fallow health/dupes/dead-code, publint, Are the Types Wrong, and installed-consumer versions for both runners. Run `actionlint` and `git diff --check` when workflows change. `pnpm audit --prod --audit-level high` checks current production advisories.

Coverage is source-mapped V8 coverage from the source tests and the Jest and Vitest processes. Fallow uses measured Istanbul function coverage where it can match functions and a static estimate elsewhere. Coverage numbers are not browser conformance scores or deterministic GC guarantees. See [TESTING.md](../TESTING.md).

## CI evidence

The [Test workflow](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml) runs Node 22.18.0 / 24.20.0 / 26.8.1 on Linux and Windows. The [other workflows](https://github.com/laststance/happy-dom-extended/actions) cover lint and documentation links, formatting, types, package build, Fallow, CodeQL, dependency review, audit, Socket dependency scanning, and Scorecard. Codecov receives the Linux Node 24 source report.

Recorded execution: the [successful PR #16 Test run](https://github.com/laststance/happy-dom-extended/actions/runs/35753808848) ran all six Linux/Windows combinations on commit `97a9612f45f160d904ad37fcc6672d5ad18fd56a`. Every job used pnpm 12.3.4, Jest 30.5.1 and Vitest 5.0.1 integration, and installed Jest 30.0.0/30.5.1 and Vitest 4.0.0, 4.1.11 and 5.0.1 consumers. On Windows, the `threads` and `vmThreads` consumers used the global setup and passed. The setup logs report each Node.js release's bundled npm on both operating systems. The Node 22 jobs then install npm 11.19.0, because npm 10.9.3 failed on the second isolated Vitest consumer install:

| Node.js | Bundled npm | npm for installed consumers |
| ------- | ----------- | --------------------------- |
| 22.18.0 | 10.9.3      | 11.19.0                     |
| 24.20.0 | 11.19.0     | 11.19.0                     |
| 26.8.1  | 11.19.0     | 11.19.0                     |

The workflow definitions describe the configured matrix beyond that recorded commit. A local macOS pass does not prove Windows/Linux execution: inspect the successful runs for the PR's exact commit. Scorecard runs on `main`, scheduled runs, and repository policy changes, so its first result follows merge. The Test workflow does not publish. After Test succeeds on a `main` push, the Release workflow may open a Version Packages PR or publish pending versions.

## Boundaries and release status

Jest 30.5.1 evaluates setup modules outside part of its teardown protection. Application setup that opens native channels must clean up if setup fails; preserving native references prevents silent early process exit. This runner boundary and rendering limitations are described in the [package guide](../packages/jest-happy-dom-extended/README.md#runtime-boundaries).

`jest-happy-dom-extended` 0.2.0 is published on npm. Pending Changesets release `vitest-environment-happy-dom-extended` 0.1.0 and `jest-happy-dom-extended` 0.2.1. `packages/compat` remains private and bundled into both public runner packages. See [Canvas compatibility and verification](canvas-compatibility.md) for current guarantees, native prerequisites, selected WPT coverage and measured renderer differences. Earlier research documents are historical evidence, not the current support contract.

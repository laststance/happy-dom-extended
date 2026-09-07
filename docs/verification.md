# Verification

The current implementation owns Canvas semantics around CPU skia-canvas 3.0.8, including real image/video sources, origin-clean checks, ImageData color conversion, Bitmap transport and dedicated Workers. The runtime baseline is pinned Happy DOM 20.14.0 and Jest 30.5.1, with installed consumers also checked against Jest 30.0.0. The official node-canvas adapter remains a development-only interoperability fixture.

## Local evidence

Local tests ran on macOS arm64 with Node.js 24.20.0. Test output, not a zero process exit alone, determines completion.

| Layer                               | Expected successful execution                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node source regressions             | 166 tests, including the implementation and PR review regressions                                         |
| Jest integration                    | 20 tests in 4 suites                                                                                      |
| Installed consumer per Jest version | 11 lifecycle tests; 10 Jest tests in 3 suites in serial mode; the same 10 tests with two worker processes |
| Public entry points                 | Shared ESM/CommonJS runtime, consistent Happy DOM class identity, removed `/canvas` rejected              |

The isolated tarball is installed outside this checkout in a path containing spaces, with native install scripts enabled. The fixture does not install Canvas directly. PNG is independently decoded using pngjs; JPEG/WebP are decoded by FFmpeg and compared with documented tolerance. The private Worker bootstrap executes from the installed package, including Blob-based scripts. Setup records verify worker process identities, and Jest JSON reports verify every expected suite and test.

Source tests cover actual red/blue/transparent pixels, Window ImageData types, same-value and attribute dimension resets, resized source canvases, image output before context creation, snapshot preservation during redraw/resize, Happy DOM waiting, callback and encoder failures, frozen configuration, and teardown with unrelated intervals. Mixed ESM/CommonJS environments retain Canvas and Blob behavior regardless of creation/closing order. Cleanup failures preserve the original error and attempt remaining restorations.

## Reproduce the complete gate

```sh
pnpm install --frozen-lockfile
pnpm check
```

This runs Sherif, Prettier, build, Node and Jest tests with c8 coverage, ESLint, TypeScript, Fallow health/dupes/dead-code, publint, Are the Types Wrong, and both installed-consumer versions. Run `actionlint` and `git diff --check` when workflows change. `pnpm audit --prod --audit-level high` checks current production advisories.

Coverage is source-mapped V8 coverage from the source tests and Jest process. Fallow uses measured Istanbul function coverage where it can match functions and a static estimate elsewhere. Coverage numbers are not browser conformance scores or deterministic GC guarantees. See [TESTING.md](../TESTING.md).

## CI evidence

The [Test workflow](https://github.com/laststance/happy-dom-extended/actions/workflows/test.yml) runs Node 22.18.0 / 24.20.0 / 26.8.1 on Linux and Windows. The [other workflows](https://github.com/laststance/happy-dom-extended/actions) cover lint, types, package build, Fallow, CodeQL, dependency review, audit, and Scorecard. Codecov receives the Linux Node 24 source report.

These workflow definitions describe the configured matrix. A local macOS pass does not prove Windows/Linux execution: inspect the successful runs for the PR's exact commit. Scorecard runs on `main`, scheduled runs, and repository policy changes, so its first result follows merge. No npm publication happens in CI.

## Boundaries and release status

Jest 30.5.1 evaluates setup modules outside part of its teardown protection. Application setup that opens native channels must clean up if setup fails; preserving native references prevents silent early process exit. This runner boundary and rendering limitations are described in the [package guide](../packages/jest-happy-dom-extended/README.md#runtime-boundaries).

A minor Changeset records the public Canvas change. The package has not yet been published to npm; `packages/compat` remains private and bundled, and the Vitest workspace remains a placeholder. See [Canvas compatibility and verification](canvas-compatibility.md) for current guarantees, native prerequisites, selected WPT coverage and measured renderer differences. Earlier research documents are historical evidence, not the current support contract.

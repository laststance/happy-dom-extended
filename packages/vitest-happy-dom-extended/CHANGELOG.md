# vitest-environment-happy-dom-extended

## 0.1.0

### Minor Changes

- d7b63a2: Add a Vitest 4 and 5 environment that installs the same Happy DOM Canvas, Worker, and Web API extensions as the Jest package. Configure it with `environment: 'happy-dom-extended'`. It supports the `forks`, `threads`, `vmThreads`, and `vmForks` pools, loads Vitest's `populateGlobal` without Vitest 4.1's `vitest/environments` deprecation warning, and restores the original global property descriptors on teardown. Tests receive the Window's `localStorage` and `sessionStorage` on Vitest 4 and 5, including on Node.js 25 and later, which define their own. A skipped skia-canvas install script fails with the approval commands for pnpm, npm 12, and Bun. For the `threads` and `vmThreads` pools, add `globalSetup: ['vitest-environment-happy-dom-extended/global-setup']`. It loads skia-canvas in Vitest's main thread, which prevents a Windows crash with exit code 3221225477 when the last worker thread exits.

### Patch Changes

- a09226e: Stop a collected Canvas resource from aborting the process during worker teardown.

  Canvas presentation ports, decoded images and video sources are released from
  `FinalizationRegistry` callbacks. V8 reports a throw from such a callback as an
  uncaught exception, and a worker collecting a handle while tearing its
  environment down turned that into `SIGABRT`, which surfaced as a whole test run
  exiting with code 134 rather than a failing test. The video finalizer also
  discarded an async cleanup's promise, so a rejection from it had nothing
  attached. Each finalizer now releases through a helper that keeps both a throw
  and a rejection inside the callback.

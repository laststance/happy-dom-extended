---
'vitest-environment-happy-dom-extended': minor
---

Add a Vitest 4 and 5 environment that installs the same Happy DOM Canvas, Worker, and Web API extensions as the Jest package. Configure it with `environment: 'happy-dom-extended'`. It supports the `forks`, `threads`, `vmThreads`, and `vmForks` pools, loads Vitest's `populateGlobal` without Vitest 4.1's `vitest/environments` deprecation warning, and restores the original global property descriptors on teardown. Tests receive the Window's `localStorage` and `sessionStorage` on Vitest 4 and 5, including on Node.js 25 and later, which define their own. A skipped skia-canvas install script fails with the approval commands for pnpm, npm 12, and Bun. For the `threads` and `vmThreads` pools, add `globalSetup: ['vitest-environment-happy-dom-extended/global-setup']`. It loads skia-canvas in Vitest's main thread, which prevents a Windows crash with exit code 3221225477 when the last worker thread exits.

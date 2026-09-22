---
'vitest-environment-happy-dom-extended': minor
---

Add a Vitest 4 and 5 environment that installs the same Happy DOM Canvas, Worker, and Web API extensions as the Jest package. Configure it with `environment: 'happy-dom-extended'`. It supports the `forks`, `threads`, `vmThreads`, and `vmForks` pools, loads Vitest's `populateGlobal` without Vitest 4.1's `vitest/environments` deprecation warning, and restores the original global property descriptors on teardown. A skipped skia-canvas install script fails with the approval commands for pnpm, npm 12, and Bun.

---
'jest-happy-dom-extended': patch
---

Explain a skipped skia-canvas install script. When Skia's native binary is missing, the environment now fails with the approval commands for pnpm, npm 12, and Bun instead of `Cannot find module '../skia.node'`, and keeps the original error as its `cause`.

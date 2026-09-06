---
'jest-happy-dom-extended': minor
---

Provide native Canvas and OffscreenCanvas 2D rendering by default, including PNG/JPEG output available during Jest setup files. Add snapshot-safe asynchronous exports, dimension resets, Window ImageData compatibility, and complete resource cleanup. Remove the non-rendering `/canvas` helper entry. The package now installs `canvas` and the official Happy DOM adapter as runtime dependencies; native builds must be permitted by the package manager.

Expand installation, usage, contribution, testing, architecture, and security documentation. Validate Node 22, 24, and 26 on Linux and Windows, report coverage to Codecov, and run dedicated security, Scorecard, and repository health workflows.

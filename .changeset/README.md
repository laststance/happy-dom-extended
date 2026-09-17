# Changesets

Run `pnpm changeset` for public package changes. Select `jest-happy-dom-extended` and/or `vitest-environment-happy-dom-extended` and describe observable behavior in English.

The shared compatibility workspace is bundled into both public packages. A compatibility change therefore needs a changeset for each affected public package even though the shared package is private.

After review, merging to `main` lets the Release workflow open a Version Packages PR, then publish those versions after Test succeeds. `pnpm version:packages` and `pnpm run release` remain a local fallback. Publishing uses npm trusted publishing for this repository, not a long-lived `NPM_TOKEN`.

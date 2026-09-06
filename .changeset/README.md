# Changesets

Run `pnpm changeset` for public package changes. Select `jest-happy-dom-extended` and describe observable behavior in English.

The shared compatibility workspace is bundled into the Jest package. A compatibility change therefore needs a changeset for the Jest package even though the shared package is private. The reserved Vitest package is also private and cannot be published.

After review, `pnpm version:packages` prepares versions and changelogs. `pnpm run release` validates the repository and invokes Changesets publication. Publishing requires separately configured npm credentials and package ownership; no publication is performed by CI.

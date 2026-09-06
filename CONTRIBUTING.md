# Contributing

Thank you for helping make browser application tests work more faithfully in Node.js.

## Before changing behavior

Search [existing issues](https://github.com/laststance/happy-dom-extended/issues) and the research documents before adding a compatibility fix. Include a minimal reproduction, affected Node/Jest/Happy DOM versions, expected behavior, actual output, and a link to the relevant standard or upstream report. Never include credentials or private application data. For vulnerabilities, use [SECURITY.md](SECURITY.md).

Implement working behavior. Fixed return values and application-specific mocks belong in consumer tests. Preserve upstream implementations that already work. Document browser differences and test the behavior you claim to support.

## Local setup

Install Node.js 24.20.0 (see `.node-version`) and the pnpm 12.3.4 version pinned with integrity in `package.json`. Follow [pnpm's installation guide](https://pnpm.io/installation). Install the native dependencies described in the [package guide](packages/jest-happy-dom-extended/README.md#native-installation) if a prebuilt Canvas binary is unavailable.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The workspace approves the Canvas build script and retains a one-day minimum release age. Avoid disabling lifecycle scripts: a missing native Canvas binary must fail visibly.

## Make a change

1. Create a focused branch from `main`.
2. Add a regression test for the observable behavior; see [TESTING.md](TESTING.md).
3. Put shared compatibility work in `packages/compat`; keep runner configuration and lifecycle connections in the runner package.
4. Update user documentation when configuration, supported behavior, or installation changes.
5. Run `pnpm changeset` for public behavior changes. Before 1.0, breaking API changes use a minor Changeset. Use a patch for compatible fixes.
6. Run `pnpm check` and submit a PR describing the problem, resulting behavior, and verification.

Code and documentation use English. Test names use `test`, describe what breaks when they fail, and compare against literal expected values. Prefer independent readable test procedures, with Arrange/Act/Assert comments. Explain non-obvious functions concisely with JSDoc, including `@returns` and `@example`. Refer to project symbols as `{@link Symbol}`. Prettier uses `semi: false` and ESLint uses `eslint-config-ts-prefixer`.

## Tooling

- `pnpm test`: build, Node regressions, actual Jest integration, coverage.
- `pnpm test:package`: install the built tarball outside the checkout; run both supported Jest versions serially and with two workers.
- `pnpm typecheck`: TypeScript 7 compiler through the `typescript-compiler` alias. TypeScript 6 remains installed for tools using its JavaScript API.
- `pnpm lint`, `pnpm format:check`, `pnpm sherif`: source and workspace consistency.
- `pnpm health`, `pnpm dupes`, `pnpm dead-code`: Fallow checks. Run `pnpm test` first for health's measured coverage.
- `pnpm check:package`: publint and Are the Types Wrong export/type validation.

Fallow excludes test procedures from complexity and duplication scoring. It recognizes CanvasAdapter callbacks invoked by Happy DOM. Its three explicitly ignored dependency names (`canvas`, `happy-dom`, and `@happy-dom/node-canvas-adapter`) are runtime imports from the bundled private workspace; the public manifest must declare them even though static per-workspace analysis cannot follow that bundling. Isolated consumers verify their presence and shared Happy DOM class identity. Do not add ignore entries without equivalent evidence.

## Releases

Changesets manages versions and changelogs. Maintainers run `pnpm version:packages` to prepare a release and `pnpm run release` to validate and publish with separately configured npm credentials. Versioning and publishing are separate from merging a PR. There is no automatic npm publication workflow.

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

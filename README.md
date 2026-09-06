# happy-dom-extended

A pnpm monorepo for Happy DOM test environments with verified Web API compatibility fixes.

| Workspace                            | Purpose                                                          | Publication                                |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------ |
| `packages/jest-happy-dom-extended`   | Jest environment and opt-in Canvas helper                        | Initial package: `jest-happy-dom-extended` |
| `packages/compat`                    | Runner-independent compatibility installers and regression tests | Private; bundled into adapters             |
| `packages/vitest-happy-dom-extended` | Reserved location for the next-phase Vitest adapter              | Private; no implementation yet             |

See the [Jest package guide](packages/jest-happy-dom-extended/README.md) for consumer usage and the [source-grounded research brief](docs/research/2026-09-06-web-api-compatibility.md) for sources, reproduced gaps, exclusions, and the query log.

The [verification record](docs/verification.md) includes the review corrections, Node.js 22/24 test results, and package quality checks.

## Development

Use Node.js 24.20.0 (`.node-version`). Runtime compatibility is checked from Node.js 22.18.0 upward within the documented Node 22/24 test matrix.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The repository pins pnpm 12.3.4 with an integrity hash. `pnpm-workspace.yaml` retains a one-day minimum release age and explicitly permits the native dependency build scripts used by the toolchain.

| Task                                           | Command                             |
| ---------------------------------------------- | ----------------------------------- |
| Build ESM, CommonJS, declarations, source maps | `pnpm build`                        |
| TypeScript 7 type checking                     | `pnpm typecheck`                    |
| ESLint using `eslint-config-ts-prefixer`       | `pnpm lint` / `pnpm lint:fix`       |
| Formatting                                     | `pnpm format` / `pnpm format:check` |
| Monorepo dependency consistency                | `pnpm sherif`                       |
| Complexity and maintainability                 | `pnpm health`                       |
| Production code duplication                    | `pnpm dupes`                        |
| Dead code and dependency hygiene               | `pnpm dead-code`                    |
| Compatibility and actual Jest integration      | `pnpm test`                         |
| npm export/type analysis                       | `pnpm check:package`                |
| Clean consumer installation of the tarball     | `pnpm test:package`                 |
| Reproduce the upstream behavior                | `pnpm probe:upstream`               |

`pnpm check` builds before checking files that import the built package. When running individual lint or typecheck commands immediately after cloning, run `pnpm build` first.

## Toolchain choice

The typecheck command runs stable **TypeScript 7.0.2** through the `typescript-compiler` npm alias. **TypeScript 6.0.3** remains the `typescript` dependency for the JavaScript compiler API required by ESLint and declaration generation. This follows the published peer range of `eslint-config-ts-prefixer` 5.0.0 without replacing compiler internals or suppressing peer checks. See the research brief for registry evidence.

The other initial versions are tsdown 0.23.0, Jest 30.5.1, Happy DOM 20.14.0, ESLint 10.10.0, Sherif 1.13.0, and Fallow 3.22.0. The lockfile is the complete dependency record.

Fallow's health and duplication passes exclude test procedures to preserve descriptive, independent regression cases. Dead-code analysis still includes test entry points. All three passes fail when findings are reported; no initial baseline hides findings.

## Package development and release

The shared compatibility workspace is bundled into each adapter. It is not a runtime npm dependency, and the future Vitest adapter will not need Jest.

Public changes use [Changesets](.changeset/README.md). `pnpm version:packages` prepares release versions and changelogs; `pnpm run release` validates and publishes using separately configured npm credentials. CI does not publish. The initial repository setup does not claim a GitHub repository or npm release already exists.

CI includes lint/quality checks, typechecking, build/package analysis, and Node 22/24 tests on Linux and Windows. The isolated tarball consumer checks Jest 30.0.0 and the development version, including both setup phases. Remote actions are pinned to commits, permissions are read-only, and only the pnpm store is cached. Dependabot maintains GitHub Actions pins.

## Contribution policy

New compatibility behavior needs a primary source or a reproducible upstream gap, an observable regression test, and a lifecycle restoration test when it owns resources or shared prototypes. Preserve working upstream implementations except for documented method repairs. `Blob.text()` is deliberately supplied synchronously so setup files can decode UTF-8 before Jest's setup hook. Feature requests requiring real rendering, a browser scheduler, or complete Worker semantics should document that requirement instead of adding a no-op global.

Code and documentation are English. Tests use `test`, descriptive behavior names, hard-coded expectations, and Arrange/Act/Assert sections.

## License

MIT. See [LICENSE](LICENSE).

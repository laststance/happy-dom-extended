# Initial implementation verification

Verified on 2026-09-06 on macOS arm64, with Happy DOM 20.14.0 and Jest 30.5.1.

## Runtime results

| Verification                                                | Node.js 22.18.0       | Node.js 24.20.0       |
| ----------------------------------------------------------- | --------------------- | --------------------- |
| Shared compatibility regressions                            | 16 passed             | 16 passed             |
| Actual Jest environment, Canvas helper, environment options | 12 passed in 3 suites | 12 passed in 3 suites |
| Separately installed npm tarball consumer                   | 2 passed              | 2 passed              |
| ESM and CommonJS entry points, including Canvas subpath     | Passed                | Passed                |

The consumer verification creates a unique operating-system temporary directory outside the repository, copies only the consumer source files, and installs the packed package with Jest. It cannot resolve missing dependencies from this workspace's parent directories. Its temporary files are removed after the run. See [the packaging script](../scripts/test-package.mjs).

Node.js 22.18.0 was invoked directly from an installed platform binary; the existing system runtime was retained. These are local macOS results. The configured Linux CI matrix has not run on GitHub yet.

## Source and package checks

`pnpm install --frozen-lockfile` and the complete `pnpm check` command passed on Node.js 24.20.0.

| Check                                               | Result                                                       |
| --------------------------------------------------- | ------------------------------------------------------------ |
| TypeScript 7.0.2                                    | No type errors                                               |
| ESLint 10.10.0 with eslint-config-ts-prefixer 5.0.0 | No errors or warnings                                        |
| Prettier                                            | All files formatted                                          |
| Sherif                                              | No workspace issues                                          |
| Fallow health                                       | 90 / A; no findings above the failure threshold              |
| Fallow dupes                                        | No duplication findings                                      |
| Fallow dead-code                                    | No unused-code or dependency findings                        |
| tsdown                                              | ESM, CommonJS, separate declaration files, source maps built |
| publint                                             | Passed                                                       |
| Are the Types Wrong?                                | Node16 CJS/ESM and bundler resolutions passed                |
| actionlint                                          | Four workflows passed syntax validation                      |
| Git whitespace check                                | Passed                                                       |

The package checker uses the `node16` profile because the package requires Node.js 22.18.0 or newer and uses conditional exports. Legacy `node10` resolution of the Canvas subpath is outside that contract. The top-level CommonJS fallback and its type declaration agree.

The CI configuration runs lint/quality checks, typechecking, build/package checks, and a Node.js 22.18.0 / 24.20.0 test matrix. It uses pinned actions, read-only permissions, and a frozen lockfile. CI publication is not configured.

## Reproduction and delivery state

Run `pnpm probe:upstream` to inspect the unmodified upstream behavior. The initial [probe output](research/upstream-20.14.0-probe.log) records the gaps and the successful AES-GCM key import that justified leaving crypto unchanged. The [research brief](research/2026-09-06-web-api-compatibility.md) links the community reports, standards, and implementation decisions.

`jest-happy-dom-extended` is implemented at version 0.1.0. The shared compatibility workspace is private and bundled into that package. `vitest-happy-dom-extended` is a private placeholder for the explicitly requested later phase.

The repository and a local npm tarball are prepared. No GitHub repository or npm registry release was created in this implementation task. The original Zumen checkout remains unchanged.

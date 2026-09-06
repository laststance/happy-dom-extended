# Implementation and review verification

Verified on 2026-09-06 on macOS arm64 after the review corrections, with Happy DOM 20.14.0, Jest 30.5.1 integration tests, and Jest 30.0.0 / 30.5.1 installed-package consumers.

## Runtime results

| Verification                                                | Node.js 22.18.0       | Node.js 24.20.0       |
| ----------------------------------------------------------- | --------------------- | --------------------- |
| Shared compatibility regressions                            | 18 passed             | 18 passed             |
| Actual Jest environment, Canvas helper, environment options | 12 passed in 3 suites | 12 passed in 3 suites |
| Separately installed npm tarball consumer, Jest 30.0.0      | 2 passed              | 2 passed              |
| Separately installed npm tarball consumer, Jest 30.5.1      | 2 passed              | 2 passed              |
| ESM and CommonJS entry points, including Canvas subpath     | Passed                | Passed                |

The consumer verification creates a unique operating-system temporary directory outside the repository, copies only the consumer source files, and installs the packed package with each Jest version in an independent directory. It exercises APIs in `setupFiles`, awaits real native-channel delivery, checks `setupFilesAfterEnv`, and requires both expected tests in Jest's JSON report. An exit code of zero with no executed tests fails verification. The temporary directory contains a space to exercise argument handling. It cannot resolve missing dependencies from this workspace's parent directories, and temporary files are removed after the run. See [the packaging script](../scripts/test-package.mjs).

Node.js 22.18.0 was invoked directly from an installed platform binary; the existing system runtime was retained. These are local macOS results. The configured Linux and Windows CI matrix has not run on GitHub yet; no native Windows pass is claimed.

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

The CI configuration runs lint/quality checks, typechecking, build/package checks, and Linux / Windows × Node.js 22.18.0 / 24.20.0 tests. It uses pinned actions, read-only permissions, and a frozen lockfile. CI publication is not configured.

## Review corrections

- API installation completes during environment construction, before Jest evaluates application setup files. Constructor failure releases the upstream timer managers and closes the window after the shared installer rolls back its mutations.
- Blob UTF-8 normalization is installed synchronously and retained until the final environment releases the shared prototype. Regression cases cover disposal before an awaiting caller resumes, plus a late installation failure while another environment remains active.
- The Canvas entry imports only the shared property helper. It no longer loads Node Web Streams inside the Jest 30.0.0 runtime, where that import previously crashed before any tests ran.
- Package verification uses `cross-spawn` for Windows command shims and checks both the advertised Jest minimum and the current development version.

Jest 30.5.1 evaluates `setupFiles` outside its environment teardown `try/finally`. A setup module that opens native channels must close them itself when initialization throws. This runner boundary was reproduced and is documented in the [package guide](../packages/jest-happy-dom-extended/README.md#runtime-boundaries). Native channel reference behavior is preserved so asynchronous setup cannot exit successfully without reaching its tests.

## Reproduction and delivery state

Run `pnpm probe:upstream` to inspect the unmodified upstream behavior. The initial [probe output](research/upstream-20.14.0-probe.log) records the gaps and the successful AES-GCM key import that justified leaving crypto unchanged. The [research brief](research/2026-09-06-web-api-compatibility.md) links the community reports, standards, and implementation decisions.

`jest-happy-dom-extended` is implemented at version 0.1.0. The shared compatibility workspace is private and bundled into that package. `vitest-happy-dom-extended` is a private placeholder for the explicitly requested later phase.

The implementation and a local npm tarball are prepared. The project is hosted at [laststance/happy-dom-extended](https://github.com/laststance/happy-dom-extended). The package has not been published to the npm registry.

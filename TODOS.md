# TODOs

Tracked follow-ups for the public packages and their release automation.

## Vitest environment

### Reproduce the one-off isolate:false hang

**What:** Reproduce and explain one laststance/corelive `vitest run --no-isolate` run that hung at full CPU for over ten minutes with `vitest-environment-happy-dom-extended`.

**Why:** Seven further attempts, including an exact replay, passed. An unexplained hang may return in other non-isolated suites.

**Context:** corelive is not written for `isolate: false`; 32 to 162 of its tests fail there with this environment and with `happy-dom`. If it recurs, capture a worker CPU profile and the active handles before stopping it. See [real application trials](docs/verification.md#real-application-trials).

**Effort:** M
**Priority:** P3
**Depends on:** A reproduction

## Completed

### Confirm the Codecov upload on a fork pull request

Resolved with a deterministic fallback: the secret is exposed through a job-level `env` (the `secrets` context is not allowed in `if:` expressions) and the upload step requires `env.CODECOV_TOKEN != ''`, so a fork pull request skips coverage upload instead of failing the required `test` check. Same-repo pull requests and `main` runs are unchanged. Tokenless upload remains unexercised — an acceptable trade since skipping never blocks an outside contribution. Issue: laststance/happy-dom-extended#35.

### Evaluate staged npm publishing

Adopted. Both `packages/*/.release-it.json` set `npm.stage`, so release-it runs `pnpm stage publish --provenance --no-git-checks` instead of `pnpm publish`, and every named version lands as a staged draft that a maintainer approves under Profile → Staged packages on npmjs.com. The Release job's provenance poll cannot see a staged version, so it now writes the staged packages to the job summary and the attestation check moved to the post-approval step in [docs/releasing.md](docs/releasing.md), which also covers rejecting a staged upload that logged `Skipped setting provenance`.

### Report the Windows skia.node unload crash to skia-canvas

Reported as samizdatco/skia-canvas#303 with the measured crash matrix from [Verification](docs/verification.md#windows-thread-pool-crash) and a suggestion to pin the module or stop its threads when the last Node environment exits. Until a fixed skia-canvas release, `threads` and `vmThreads` users still need `vitest-environment-happy-dom-extended/global-setup`; the setup entry stays after any fix so existing configurations keep resolving.

### Drop the dangling declaration-map reference from the published types

`scripts/dts-sourcemap.mjs` strips the trailing `//# sourceMappingURL=*.d.*.map` comment after `tsdown` in each package's `build`, and `check:package` re-runs it with `--check` so the reference cannot return silently. Reported upstream as rolldown/tsdown#1091. Issue: laststance/happy-dom-extended#33.

### Decide how a worker reports a failed teardown

Decided: suppress. Every fire-and-forget teardown call now owns its rejection with `.catch(() => {})`, matching the existing `void this.completion.catch(() => {})` convention in the canvas sources. A teardown rejection after `terminate()` or Window close has no observer — `#stop` has already set `#stopped`, which closes the ErrorEvent path — so an unhandled rejection could only abort the whole process, while the worker-initiated `close()` → control `error` → Window ErrorEvent contract is unchanged because that reporting happens before the promise settles.

Along the way, `#stop` in `install-workers.ts` was fixed so a close-message post that throws can no longer skip the forced-termination timer and strand the child thread, and `loadCanvasVideo` in `videos.ts` now owns the previous source's disposal promise on its no-source early return. `window.happyDOM.close()` still reports joined teardown failures through `disposeAll`. Issue: laststance/happy-dom-extended#27.

### Require a pull request and block force pushes on main

Applied `pull_request` (zero required approvals) and `non_fast_forward` to ruleset 22409011; the existing `deletion`, `required_status_checks`, `code_scanning`, `code_quality` and `code_coverage` rules are unchanged. Every change to `main` now lands through a pull request that must pass the required checks, and force pushes are rejected. The SECURITY.md finding list was updated. Issue: laststance/happy-dom-extended#29.

### Decide on a dependency update tool

Decided: Dependabot. `.github/dependabot.yml` updates `github-actions` and `npm` development dependencies weekly — `allow: dependency-type: development` keeps `happy-dom`, `skia-canvas` and every other runtime dependency pinned to the versions the verification matrix covers. Minor/patch dev-dependency updates are grouped into one PR to limit noise; majors arrive individually. SECURITY.md updated. Issue: laststance/happy-dom-extended#31.

### Claim the Vitest vmForks pool

Completed in `vitest-environment-happy-dom-extended` 0.1.0. The behavior suite, the installed consumer and the React product fixture run in `vmForks` on Vitest 4.0.0, 4.1.11 and 5.0.1. Setup records prove a child process with a VM context.

### Investigate Vitest threads plus Skia

Completed in the same 0.1.0. skia-canvas loads in each worker thread. The behavior suite, dedicated Worker tests and pixel checks pass in `threads` and `vmThreads` with two concurrent workers, and setup records prove worker threads inside the CLI process. laststance/corelive and laststance/gitbox produce the same results in `threads` as in `forks`.

On Windows, a thread-pool run could crash after its tests passed, because Windows unloaded skia.node when the last worker thread that loaded it exited. The `vitest-environment-happy-dom-extended/global-setup` entry loads skia-canvas in Vitest's main thread first; [Verification](docs/verification.md#windows-thread-pool-crash) records the experiments.

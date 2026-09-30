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

### Report the Windows skia.node unload crash to skia-canvas

**What:** Report to skia-canvas that Windows can unload skia.node while threads that skia-canvas started still run code inside it.

**Why:** Until skia-canvas keeps its binary loaded, `threads` and `vmThreads` users must add `vitest-environment-happy-dom-extended/global-setup`. Other tools that load skia-canvas only in worker threads can crash the same way.

**Context:** Node releases a worker thread's handle to a native addon when the thread exits, and Windows unloads the addon when no handle remains. The worker-thread experiment in [Verification](docs/verification.md#windows-thread-pool-crash) crashed on Node.js 24.20.0 and 26.8.1 without Vitest. skia-canvas could pin its module on Windows or stop its threads when the last Node environment that uses it exits. After a fixed release, keep the global setup entry so existing configurations still resolve.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

## Release automation

### Drop the dangling declaration-map reference from the published types

**What:** Stop shipping a `sourceMappingURL` comment for a declaration map that the tarball does not contain, and report it to tsdown.

**Why:** Editors resolve the comment to a missing file. TypeScript ignores it, so today this only makes the artifact look unfinished.

**Context:** tsdown 0.23.0 passes the bundle's `sourcemap: true` to the declaration output, which appends the comment, while `dts.sourcemap` decides whether a map is written. Enabling `dts: { sourcemap: true }` writes maps whose `sources` point at `../src/*.ts` without `sourcesContent`, so they do not resolve from a tarball either. Removing the comment needs a tsdown fix or a post-build rewrite.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Decide on a dependency update tool

**What:** Decide whether Dependabot or Renovate should run, and over which dependency groups.

**Why:** OpenSSF Scorecard scores this repository zero for dependency updates, and pinned dependencies drift without a tool.

**Context:** `happy-dom` and `skia-canvas` are pinned to the exact versions [Verification](docs/verification.md) records, so a bump needs the whole matrix re-run before it can merge. Remote actions are already pinned by commit digest and could be updated on their own schedule. Limiting a tool to actions and development dependencies would close most of the finding without invalidating the recorded evidence. [SECURITY.md](SECURITY.md) explains why the finding stays open meanwhile.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Require a pull request and block force pushes on main

**What:** Add the `pull_request` and `non_fast_forward` rules to the `main` ruleset.

**Why:** `main` accepts a direct push and a force push today, so the required status checks can be bypassed entirely by pushing to it. OpenSSF Scorecard scores branch protection 1 out of 10 for exactly these two gaps.

**Context:** Ruleset 22409011 targets the default branch with `deletion`, `required_status_checks`, `code_scanning`, `code_quality` and `code_coverage`, and no bypass actors. Repository rules are public, so Scorecard reads them without a token. Adding `pull_request` with zero required approvals keeps a solo maintainer's flow intact while routing every change through the checks. Releases already go through a pull request titled `release <short>@<version>`, so the rule does not change that flow. [SECURITY.md](SECURITY.md) records the finding meanwhile.

**Effort:** S
**Priority:** P2
**Depends on:** Nothing

### Confirm the Codecov upload on a fork pull request

**What:** Establish whether the coverage upload succeeds on a pull request from a fork, and add a fallback if it does not.

**Why:** `test` is a required status check. The upload step passes `secrets.CODECOV_TOKEN` and sets `fail_ci_if_error: true`, and a fork pull request cannot read that secret, so a failing upload would block every outside contribution.

**Context:** `.github/workflows/test.yml` runs the upload only on Linux Node 24.20.0. codecov-action v7 documents a tokenless flow for public repositories, which this repository has never exercised because no fork pull request has been opened. Either confirm the tokenless path or skip the step when the token is empty. [TESTING.md](TESTING.md) records the current state.

**Effort:** S
**Priority:** P3
**Depends on:** A fork pull request, or a deliberate test of one

## Completed

### Evaluate staged npm publishing

Adopted. Both `packages/*/.release-it.json` set `npm.stage`, so release-it runs `pnpm stage publish --provenance --no-git-checks` instead of `pnpm publish`, and every named version lands as a staged draft that a maintainer approves under Profile → Staged packages on npmjs.com. The Release job's provenance poll cannot see a staged version, so it now writes the staged packages to the job summary and the attestation check moved to the post-approval step in [docs/releasing.md](docs/releasing.md), which also covers rejecting a staged upload that logged `Skipped setting provenance`.

### Decide how a worker reports a failed teardown

Decided: suppress. Every fire-and-forget teardown call now owns its rejection with `.catch(() => {})`, matching the existing `void this.completion.catch(() => {})` convention in the canvas sources. A teardown rejection after `terminate()` or Window close has no observer — `#stop` has already set `#stopped`, which closes the ErrorEvent path — so an unhandled rejection could only abort the whole process, while the worker-initiated `close()` → control `error` → Window ErrorEvent contract is unchanged because that reporting happens before the promise settles.

Along the way, `#stop` in `install-workers.ts` was fixed so a close-message post that throws can no longer skip the forced-termination timer and strand the child thread, and `loadCanvasVideo` in `videos.ts` now owns the previous source's disposal promise on its no-source early return. `window.happyDOM.close()` still reports joined teardown failures through `disposeAll`. Issue: laststance/happy-dom-extended#27.

### Claim the Vitest vmForks pool

Completed in `vitest-environment-happy-dom-extended` 0.1.0. The behavior suite, the installed consumer and the React product fixture run in `vmForks` on Vitest 4.0.0, 4.1.11 and 5.0.1. Setup records prove a child process with a VM context.

### Investigate Vitest threads plus Skia

Completed in the same 0.1.0. skia-canvas loads in each worker thread. The behavior suite, dedicated Worker tests and pixel checks pass in `threads` and `vmThreads` with two concurrent workers, and setup records prove worker threads inside the CLI process. laststance/corelive and laststance/gitbox produce the same results in `threads` as in `forks`.

On Windows, a thread-pool run could crash after its tests passed, because Windows unloaded skia.node when the last worker thread that loaded it exited. The `vitest-environment-happy-dom-extended/global-setup` entry loads skia-canvas in Vitest's main thread first; [Verification](docs/verification.md#windows-thread-pool-crash) records the experiments.

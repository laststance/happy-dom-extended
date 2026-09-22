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

## Release automation

### Run Version Packages PR checks without manual approval

**What:** Let the Release workflow open the Version Packages PR with a GitHub App installation token instead of `GITHUB_TOKEN`.

**Why:** Workflows on the bot's PR stop at `action_required` until a maintainer selects "Approve workflows to run". Every `main` push rebuilds the branch, so each new head needs approval again.

**Context:** `workflow_dispatch` runs do not satisfy required status checks. Scope the App token to contents and pull requests, and keep npm publishing on OIDC.

**Effort:** S
**Priority:** P2
**Depends on:** A Laststance GitHub App installed on this repository

## Completed

### Claim the Vitest vmForks pool

Completed for `vitest-environment-happy-dom-extended` 0.1.0. The behavior suite, the installed consumer and the React product fixture run in `vmForks` on Vitest 4.0.0, 4.1.11 and 5.0.1. Setup records prove a child process with a VM context.

### Investigate Vitest threads plus Skia

Completed for 0.1.0. skia-canvas loads in each worker thread. The behavior suite, dedicated Worker tests and pixel checks pass in `threads` and `vmThreads` with two concurrent workers, and setup records prove worker threads inside the CLI process. laststance/corelive and laststance/gitbox produce the same results in `threads` as in `forks`.

On Windows, a thread-pool run could crash after its tests passed, because Windows unloaded skia.node when the last worker thread that loaded it exited. The `vitest-environment-happy-dom-extended/global-setup` entry loads skia-canvas in Vitest's main thread first; [Verification](docs/verification.md#windows-thread-pool-crash) records the experiments.

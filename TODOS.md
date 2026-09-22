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

### Run Version Packages PR checks without manual approval

**What:** Let the Release workflow open the Version Packages PR with a GitHub App installation token instead of `GITHUB_TOKEN`.

**Why:** Workflows on the bot's PR stop at `action_required` until a maintainer selects "Approve workflows to run". Every `main` push rebuilds the branch, so each new head needs approval again.

**Context:** `workflow_dispatch` runs do not satisfy required status checks. Scope the App token to contents and pull requests, and keep npm publishing on OIDC.

**Effort:** S
**Priority:** P2
**Depends on:** A Laststance GitHub App installed on this repository

### Drop the dangling declaration-map reference from the published types

**What:** Stop shipping a `sourceMappingURL` comment for a declaration map that the tarball does not contain, and report it to tsdown.

**Why:** Editors resolve the comment to a missing file. TypeScript ignores it, so today this only makes the artifact look unfinished.

**Context:** tsdown 0.23.0 passes the bundle's `sourcemap: true` to the declaration output, which appends the comment, while `dts.sourcemap` decides whether a map is written. Enabling `dts: { sourcemap: true }` writes maps whose `sources` point at `../src/*.ts` without `sourcesContent`, so they do not resolve from a tarball either. Removing the comment needs a tsdown fix or a post-build rewrite.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Evaluate staged npm publishing

**What:** Decide whether the Release job should stage each version for manual approval instead of publishing directly.

**Why:** A staged version needs a maintainer's approval before consumers can install it, so a compromised workflow cannot reach the registry on its own.

**Context:** Since 3 September 2026 every trusted publishing configuration can stage a version, and direct publishing is opt-in. `npm trust` takes `--allow-publish` and `--allow-stage-publish` as separate permissions, and [npm's guide](https://docs.npmjs.com/cli/v12/commands/npm-stage) recommends allowing only staged publishing. Staging prompts for no second factor; approving does, and a trusted publisher's short-lived token can run `npm publish` and `npm stage publish` but no other `npm stage` subcommand, so approval stays a maintainer's action at the keyboard. Confirm the minimum npm and Node.js versions in that guide before adopting it; the commands above were read from npm 12.0.2. Changesets 3.0.2 detects this pnpm workspace and publishes with `pnpm pack` followed by `pnpm publish <tarball> --access public --tag <tag> --no-git-checks`, so it never stages. Staging therefore needs Changesets support or a replacement publish script, plus a configuration created with `--allow-stage-publish`.

**Effort:** M
**Priority:** P3
**Depends on:** Changesets support for staged publishing

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

**Context:** Ruleset 22409011 targets the default branch with `deletion`, `required_status_checks`, `code_scanning`, `code_quality` and `code_coverage`, and no bypass actors. Repository rules are public, so Scorecard reads them without a token. Adding `pull_request` with zero required approvals keeps a solo maintainer's flow intact while routing every change through the checks. Confirm first that the Version Packages branch still merges, because `changesets/action` pushes to `changeset-release/main` and opens a pull request rather than pushing to `main`. [SECURITY.md](SECURITY.md) records the finding meanwhile.

**Effort:** S
**Priority:** P2
**Depends on:** Nothing

## Completed

### Claim the Vitest vmForks pool

Completed for `vitest-environment-happy-dom-extended` 0.1.0. The behavior suite, the installed consumer and the React product fixture run in `vmForks` on Vitest 4.0.0, 4.1.11 and 5.0.1. Setup records prove a child process with a VM context.

### Investigate Vitest threads plus Skia

Completed for 0.1.0. skia-canvas loads in each worker thread. The behavior suite, dedicated Worker tests and pixel checks pass in `threads` and `vmThreads` with two concurrent workers, and setup records prove worker threads inside the CLI process. laststance/corelive and laststance/gitbox produce the same results in `threads` as in `forks`.

On Windows, a thread-pool run could crash after its tests passed, because Windows unloaded skia.node when the last worker thread that loaded it exited. The `vitest-environment-happy-dom-extended/global-setup` entry loads skia-canvas in Vitest's main thread first; [Verification](docs/verification.md#windows-thread-pool-crash) records the experiments.

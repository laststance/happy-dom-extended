# npm release

The publishable packages are `jest-happy-dom-extended` and `vitest-environment-happy-dom-extended`. The repository root and compatibility workspace are private. GitHub Actions validate every change. After the Test workflow succeeds on a `main` push, the Release workflow either opens a Version Packages PR or publishes pending versions to npm with OIDC trusted publishing.

## Release with CI

1. In the feature PR, run `pnpm changeset`, select each public package the change affects and describe the observable behavior. Commit the generated `.changeset/*.md` file with the change. A change to the private compatibility workspace needs a changeset for every public package that bundles it.
2. Merge the feature PR. Merging does not publish. After Test succeeds on that `main` push, Release runs `changeset version` and opens or updates the Version Packages PR (`chore: version packages`, branch `changeset-release/main`). That PR bumps each package version, writes its CHANGELOG entry and deletes the consumed changeset files.
3. On the Version Packages PR, select **Approve workflows to run**. GitHub holds workflows on this bot-authored PR at `action_required`, and the required checks cannot pass until a maintainer approves them. Every later `main` push rebuilds the branch and needs a new approval.
4. Review the versions and CHANGELOG entries, and [inspect the tarballs](#inspect-the-tarballs) when a release changes packaging. Merge the PR after its checks pass.
5. Wait for Test on that merge. Release then runs `changeset publish`, which detects the pnpm workspace and publishes each version that is not yet on the registry with `pnpm publish` over OIDC trusted publishing. npm records a provenance attestation for each version and moves `latest` to it.
6. Release fails if a published version has no SLSA provenance attestation on the registry.
7. Confirm the published versions:

   ```sh
   npm view jest-happy-dom-extended dist-tags --registry=https://registry.npmjs.org
   npm view vitest-environment-happy-dom-extended dist-tags --registry=https://registry.npmjs.org
   npm view "vitest-environment-happy-dom-extended@VERSION" dist.attestations.provenance.predicateType --registry=https://registry.npmjs.org
   ```

   The last command prints `https://slsa.dev/provenance/v1` for a version that Release published.

Release runs only after a successful Test run for a `main` push, and only when that run's commit is still the tip of `main`; a newer push releases through its own Test run instead. When Release fails before a version is uploaded, for example on a trusted publisher mismatch, fix the cause and re-run the failed Release run. `changeset publish` skips versions that the registry already holds, so a re-run publishes only what is missing.

## Trusted publishers

Each public package on npmjs.com trusts this repository's Release workflow. The configuration lives under the package's **Settings** → **Trusted Publisher** and holds these values:

| Field                | Value                                     |
| -------------------- | ----------------------------------------- |
| Publisher            | GitHub Actions                            |
| Organization or user | `laststance`                              |
| Repository           | `happy-dom-extended`                      |
| Workflow filename    | `release.yml` (filename only, exact case) |
| Environment name     | empty                                     |
| Allowed actions      | direct `npm publish` allowed              |

The Release job declares no GitHub Actions environment, so a configuration naming one does not match its ID token. npm fixes these fields when the configuration is created; changing one means deleting the configuration and creating it again. `npm trust list <package>` prints the current configuration and asks for the account's second factor in the browser.

Since 3 September 2026 every new configuration may stage a version, while direct publishing is opt-in, so the configuration needs direct publishing enabled on npmjs.com, or `--allow-publish` with `npm trust github`. Without it a configuration can only stage a version for manual approval, and this repository's Release job publishes directly. npm recommends the opposite, allowing only staged publishing so that a maintainer approves each version with a second factor; [TODOS.md](../TODOS.md) tracks that trade-off. Do not set `NODE_AUTH_TOKEN`, `NPM_TOKEN` or `NPM_CONFIG_PROVENANCE` on the Release job. pnpm 11 and later ignore `NPM_CONFIG_PROVENANCE`, and trusted publishing adds provenance for this public repository by itself.

A trusted publisher can only be attached to a package that already exists, so OIDC cannot create a new package. A new public package needs one manual publish of a deprecated `0.0.0` placeholder from a clean `main` checkout, and a trusted publisher added afterwards, before its first Version Packages PR is merged. Without that, Release fails the new package's publish while the other packages still publish.

## Provenance failures

Release checks the registry for an attestation (step 6 above) because pnpm treats the two provenance failures differently, and only one of them leaves the registry untouched. A failure to sign the statement ends the run with `ERR_PNPM_PROVENANCE_SIGN` before the tarball is uploaded, so no version is created and the same merge can be released again. A failure to read the package's visibility only logs `Skipped setting provenance`, and pnpm publishes the version anyway, without an attestation; the check then fails on a version that already exists, which re-running cannot repair. Recovering from that means deprecating the unattested version and releasing the next patch, because npm does not accept a replacement for a version it already holds. Both orderings were measured against a local registry with pnpm 12.3.4, which resolves the publishing token by exchanging a GitHub Actions ID token at `/-/npm/v1/oidc/token/exchange/package/<name>` and prefers that token over any `_authToken` in the configuration.

## Inspect the tarballs

Run this on the Version Packages branch (`git switch changeset-release/main`) to inspect the exact artifacts that merging it will publish. Use the Node and pnpm versions supported by the repository, run `pnpm install --frozen-lockfile` first, and keep FFmpeg/ffprobe on PATH for the complete verification suite (`pnpm check`).

Start in the repository root and keep the maintainer blocks in the same shell. Each build creates a new absolute archive path; a new shell must repeat this block before publication:

```sh
set -eu
mkdir -p .artifacts/release
jest_release_version="$(node -p "require('./packages/jest-happy-dom-extended/package.json').version")"
jest_release_directory="$(mktemp -d "$(pwd)/.artifacts/release/pack.XXXXXX")"
jest_release_tarball="$jest_release_directory/jest-happy-dom-extended-${jest_release_version}.tgz"
pnpm --filter jest-happy-dom-extended pack --pack-destination "$jest_release_directory"
test -f "$jest_release_tarball"
tar -tzf "$jest_release_tarball"
npm publish "$jest_release_tarball" --dry-run --access public --registry=https://registry.npmjs.org
vitest_release_version="$(node -p "require('./packages/vitest-happy-dom-extended/package.json').version")"
vitest_release_directory="$(mktemp -d "$(pwd)/.artifacts/release/pack.XXXXXX")"
vitest_release_tarball="$vitest_release_directory/vitest-environment-happy-dom-extended-${vitest_release_version}.tgz"
pnpm --filter vitest-environment-happy-dom-extended pack --pack-destination "$vitest_release_directory"
test -f "$vitest_release_tarball"
tar -tzf "$vitest_release_tarball"
npm publish "$vitest_release_tarball" --dry-run --access public --registry=https://registry.npmjs.org
```

The package's prepack script builds the public entries, declarations and private Worker bootstrap. The `files` allowlist includes only distribution files, the package guide, changelog and license, plus npm's mandatory package manifest. A separate `.npmignore` is unnecessary. Registry/access are set in the public package's publishConfig; project `.npmrc` credentials are unnecessary. [npm's file selection rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files) describe how the allowlist is applied.

The block stops on a failed build or a missing archive before inspecting or dry-running publication. A dry run also fails when that name and version are already on the registry, which needs no authentication to detect, and `set -eu` then ends the block before it reaches the next package. When Release already published one package, drop that package's lines from the block. Keep the inspected archive for release records.

Expect twelve files in the Jest tarball: `dist/index.cjs`, `dist/index.d.cts`, `dist/worker.cjs`, `dist/worker.d.cts`, the shared build chunk, a source map beside each JavaScript file, README, CHANGELOG, LICENSE and package.json. The Vitest tarball holds twelve files too and is ESM-only: `dist/index.mjs`, `dist/index.d.mts`, `dist/global-setup.mjs`, `dist/global-setup.d.mts`, `dist/worker.cjs`, a source map beside each JavaScript file, the same docs/license/manifest set, and no CommonJS public entry. Repository tests, fixtures, local artifacts, credentials and workspace source directories must not appear. The public entries' declarations end with a `sourceMappingURL` comment for a declaration map that tsdown does not emit; TypeScript ignores the missing file, and [TODOS.md](../TODOS.md) tracks removing the comment. Distribution source maps may contain the public source used to build the package.

`pnpm check:package` checks package exports and type resolution (Jest uses attw `node16`; the ESM-only Vitest environment uses `esm-only`). `pnpm test:package` installs tarballs outside the repository and runs the supported Jest and Vitest versions, setup files, environment lifetimes, actual Worker/video use, every Vitest pool with the global setup in `threads` and `vmThreads`, a React product fixture and the missing-binary guidance. `pnpm check` includes both commands.

To try a prepared artifact in an application before registry publication:

```sh
npm install --save-dev jest@30 /absolute/path/to/jest-happy-dom-extended-VERSION.tgz
# or
npm install --save-dev vitest@5 /absolute/path/to/vitest-environment-happy-dom-extended-VERSION.tgz
```

Use the actual filename produced by packing. With npm 12, approve and run the required native installation script before running the tests:

```sh
npm approve-scripts skia-canvas
npm rebuild skia-canvas
```

[Approval](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) saves the package policy; [rebuild](https://docs.npmjs.com/cli/v12/commands/npm-rebuild/) runs the installation. Then use the configuration and Canvas test in the [README](../README.md#configure-jest-or-vitest). Video tests additionally need ffmpeg/ffprobe. [TESTING.md](../TESTING.md#try-an-application-before-release) describes a pnpm trial in a copy of a real application.

## Publish locally as a fallback

Publish from a local machine only when Release cannot publish, for example while npm or GitHub Actions has an outage. A local publish has no provenance attestation, and npm cannot replace a version once it exists, so that version stays unattested. Check out the `main` commit that merged the Version Packages PR, run the [inspect block](#inspect-the-tarballs) in one shell, then authenticate to the intended npm account and publish the same files that were inspected:

```sh
set -eu
: "${jest_release_tarball:=}"
: "${vitest_release_tarball:=}"
if [ -z "$jest_release_tarball" ] && [ -z "$vitest_release_tarball" ]; then
  echo 'Run the build-and-inspect block for at least one package in this shell first.' >&2
  exit 1
fi
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
if [ -n "$jest_release_tarball" ]; then
  test -f "$jest_release_tarball"
  npm publish "$jest_release_tarball" --access public --registry=https://registry.npmjs.org
fi
if [ -n "$vitest_release_tarball" ]; then
  test -f "$vitest_release_tarball"
  npm publish "$vitest_release_tarball" --access public --registry=https://registry.npmjs.org
fi
```

Keep authentication in npm's user-level configuration. npm handles any account authentication/2FA prompt in the terminal. The root `pnpm run release` command runs `pnpm check` and then publishes every pending version through Changesets from the local machine.

After publication, verify the registry version in the same shell:

```sh
set -eu
: "${jest_release_version:=}"
: "${vitest_release_version:=}"
if [ -n "$jest_release_version" ]; then
  npm view "jest-happy-dom-extended@${jest_release_version}" version dist.integrity --registry=https://registry.npmjs.org
fi
if [ -n "$vitest_release_version" ]; then
  npm view "vitest-environment-happy-dom-extended@${vitest_release_version}" version dist.integrity --registry=https://registry.npmjs.org
fi
```

Switch to a clean consumer project directory in that same shell, then install the verified versions:

```sh
set -eu
: "${jest_release_version:=}"
: "${vitest_release_version:=}"
if [ -n "$jest_release_version" ]; then
  npm install --save-dev jest@30 "jest-happy-dom-extended@${jest_release_version}" --registry=https://registry.npmjs.org
fi
if [ -n "$vitest_release_version" ]; then
  npm install --save-dev vitest@5 "vitest-environment-happy-dom-extended@${vitest_release_version}" --registry=https://registry.npmjs.org
fi
```

Apply the same npm 12 approval and rebuild steps in that clean consumer before running the README's Canvas example.

See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) for tarball and dry-run behavior.

# npm release

The publishable packages are `jest-happy-dom-extended` and `vitest-environment-happy-dom-extended`. The repository root and compatibility workspace are private. GitHub Actions validate every change. After the Test workflow succeeds on a `main` push, the Release workflow either opens a Version Packages PR or publishes pending versions to npm with OIDC trusted publishing.

## Automated release

1. Merge a reviewed PR that includes Changeset files.
2. Wait for Test on `main`. Release then opens or updates the Version Packages PR.
3. On the Version Packages PR, select **Approve workflows to run**. GitHub holds workflows on this bot-authored PR at `action_required`, and the required checks cannot pass until a maintainer approves them. Every later `main` push rebuilds the branch and needs a new approval.
4. Review and merge the Version Packages PR after its checks pass.
5. Wait for Test on that merge. Release then runs `changeset publish`, which detects the pnpm workspace and publishes each pending version with `pnpm publish` over OIDC trusted publishing, and npm records provenance for each version.
6. Release fails if a published version has no SLSA provenance attestation on the registry.

Each public package on npmjs.com must trust `laststance/happy-dom-extended`, workflow `release.yml` (filename only, exact case), with no environment and with `npm publish` allowed. Since 3 September 2026 every new configuration may stage a version, while direct publishing is opt-in, so the configuration needs `--allow-publish` or the same option on npmjs.com. Without it a configuration can only stage a version for manual approval, and this repository's Release job publishes directly. npm recommends the opposite, allowing only `--allow-stage-publish` so that a maintainer approves each version with a second factor; [TODOS.md](../TODOS.md) tracks that trade-off. Do not set `NODE_AUTH_TOKEN`, `NPM_TOKEN` or `NPM_CONFIG_PROVENANCE` on the Release job. pnpm 11 and later ignore `NPM_CONFIG_PROVENANCE`, and trusted publishing adds provenance for this public repository by itself.

### First publish of a new package

A trusted publisher can only be attached to a package that already exists, so OIDC cannot create `vitest-environment-happy-dom-extended`. Until this bootstrap is done, Release fails that package's publish while `jest-happy-dom-extended` can still publish. Complete these steps before merging the first Version Packages PR that contains the new package:

1. From a clean, up-to-date `main` checkout, sign in and publish the unreleased 0.0.0 manifest as a placeholder. Publishing needs a stored npm token, so sign in first even when the browser session on npmjs.com is active. npm asks for the account's 2FA code:

   ```sh
   npm login --registry=https://registry.npmjs.org
   npm whoami --registry=https://registry.npmjs.org
   pnpm install --frozen-lockfile
   pnpm --filter vitest-environment-happy-dom-extended publish --access public
   npm deprecate vitest-environment-happy-dom-extended@0.0.0 "Bootstrap placeholder. Install 0.1.0 or later."
   ```

   `pnpm publish` runs the package's prepack build, checks that HEAD is on `main`, and rejects an unclean tree. A single untracked file is enough to stop it with `ERR_PNPM_GIT_UNCLEAN`. Use a clean checkout rather than `--no-git-checks`.

2. Add the trusted publisher on npmjs.com, or with the npm CLI:

   ```sh
   npm trust github vitest-environment-happy-dom-extended --file release.yml --repo laststance/happy-dom-extended --allow-publish
   ```

3. Confirm that both packages list the same publisher. Release publishes them in one job, so a missing publisher on either package fails that package's publish:

   ```sh
   npm trust list vitest-environment-happy-dom-extended
   npm trust list jest-happy-dom-extended
   ```

   `jest-happy-dom-extended` 0.2.0 was published by hand and has no provenance attestation, so it may still list no publisher. Add one with the same command and that package name:

   ```sh
   npm trust github jest-happy-dom-extended --file release.yml --repo laststance/happy-dom-extended --allow-publish
   ```

4. Merge the Version Packages PR. Release publishes 0.1.0 with provenance and moves `latest` to it.

## Prepare a version

Use the Node and pnpm versions supported by the repository. FFmpeg/ffprobe must be on PATH for the complete verification suite.

```sh
pnpm install --frozen-lockfile
```

When pending Changesets exist, prepare their package version and changelog, refresh the lockfile and merge those changes before publication:

```sh
pnpm version:packages
pnpm install --lockfile-only
pnpm check
```

If the version/changelog changes are already included in the reviewed commit, skip the version command and run `pnpm check`. Confirm that the selected name/version has not already been published; npm cannot reuse an existing name/version. The version in each public package's `package.json` determines that artifact name. Run both pack/inspect blocks below when releasing both packages.

## Build and inspect the package

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

The block stops on a failed build or a missing archive before inspecting or dry-running publication. Keep the inspected archive for release records.

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

[Approval](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) saves the package policy; [rebuild](https://docs.npmjs.com/cli/v12/commands/npm-rebuild/) runs the installation. Then use the configuration and Canvas test in the [README](../README.md#configure-jest-or-vitest). Video tests additionally need ffmpeg/ffprobe. [TESTING.md](../TESTING.md#try-an-application-before-release) describes a pnpm trial in a copy of a real application. Preparation is complete after the inspected tarball and validation reports are ready.

## Publish the reviewed tarball

The maintainer performs this step after reviewing the artifact. Authenticate to the intended npm account, then publish the same file that was inspected:

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

Keep authentication in npm's user-level configuration. npm handles any account authentication/2FA prompt in the terminal. Prefer the Release workflow for registry publication, after the [first-publish bootstrap](#first-publish-of-a-new-package) for a new package. The local commands remain a fallback when CI cannot publish, and a local publish has no provenance attestation.

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

Switch to a clean consumer project directory in that same shell, then install the verified versions that were prepared:

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

See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) for tarball and dry-run behavior. The root `pnpm run release` command also publishes through Changesets after validation; it is a publication command, not part of preparation.

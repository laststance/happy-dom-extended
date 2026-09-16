# npm release

The publishable packages are `jest-happy-dom-extended` and `vitest-environment-happy-dom-extended`. The repository root and compatibility workspace are private. GitHub Actions validate every change. After the Test workflow succeeds on a `main` push, the Release workflow either opens a Version Packages PR or publishes pending versions to npm with OIDC trusted publishing.

## Automated release

1. Merge a reviewed PR that includes Changeset files.
2. Wait for Test on `main`.
3. Review and merge the Version Packages PR that Release opens.
4. Wait for Test on that merge. Release then runs `changeset publish` with npm provenance.

Configure each public package on npmjs.com as a trusted publisher for `laststance/happy-dom-extended`, workflow `release.yml` (filename only, exact case), environment none. The first `vitest-environment-happy-dom-extended` version needs that publisher before step 4. Do not set `NODE_AUTH_TOKEN` or `NPM_TOKEN` on the Release job.

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

If the version/changelog changes are already included in the reviewed commit, skip the version command and run `pnpm check`. Confirm that the selected name/version has not already been published; npm cannot reuse an existing name/version. The version in each public package's `package.json` determines that artifact name. Repeat the pack/inspect/publish block for `packages/vitest-happy-dom-extended` when releasing the Vitest environment.

## Build and inspect the package

Start in the repository root and keep the maintainer blocks in the same shell. Each build creates a new absolute archive path; a new shell must repeat this block before publication:

```sh
set -eu
release_version="$(node -p "require('./packages/jest-happy-dom-extended/package.json').version")"
mkdir -p .artifacts/release
release_directory="$(mktemp -d "$(pwd)/.artifacts/release/pack.XXXXXX")"
release_tarball="$release_directory/jest-happy-dom-extended-${release_version}.tgz"
pnpm --filter jest-happy-dom-extended pack --pack-destination "$release_directory"
test -f "$release_tarball"
tar -tzf "$release_tarball"
npm publish "$release_tarball" --dry-run --access public --registry=https://registry.npmjs.org
```

The package's prepack script builds the public entry, declarations and private Worker bootstrap. The `files` allowlist includes only distribution files, the package guide, changelog and license, plus npm's mandatory package manifest. A separate `.npmignore` is unnecessary. Registry/access are set in the public package's publishConfig; project `.npmrc` credentials are unnecessary. [npm's file selection rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files) describe how the allowlist is applied.

The block stops on a failed build or a missing archive before inspecting or dry-running publication. Keep the inspected archive for release records.

Expect `dist/index.cjs`, `dist/index.d.cts`, `dist/worker.cjs`, their build chunks, README, CHANGELOG, LICENSE and package.json for the Jest tarball. The Vitest tarball is ESM-only: `dist/index.mjs`, `dist/index.d.mts`, `dist/worker.cjs`, the same docs/license/manifest set, and no CommonJS public entry. Repository tests, fixtures, local artifacts, credentials and workspace source directories must not appear. Distribution source maps may contain the public source used to build the package.

`pnpm check:package` checks package exports and type resolution (Jest uses attw `node16`; the ESM-only Vitest environment uses `esm-only`). `pnpm test:package` installs tarballs outside the repository and runs both supported Jest and Vitest versions, setup files, environment lifetimes and actual Worker/video use in serial and two-process modes. `pnpm check` includes both commands.

To try a prepared artifact in an application before registry publication:

```sh
npm install --save-dev jest@30 /absolute/path/to/jest-happy-dom-extended-VERSION.tgz
```

Use the actual filename produced by packing. With npm 12, approve and run the required native installation script before running Jest:

```sh
npm approve-scripts skia-canvas
npm rebuild skia-canvas
```

[Approval](https://docs.npmjs.com/cli/v12/commands/npm-approve-scripts/) saves the package policy; [rebuild](https://docs.npmjs.com/cli/v12/commands/npm-rebuild/) runs the installation. Then use the Jest configuration and Canvas test in the [README](../README.md#happy-dom-extended). Video tests additionally need ffmpeg/ffprobe. Preparation is complete after the inspected tarball and validation reports are ready.

## Publish the reviewed tarball

The maintainer performs this step after reviewing the artifact. Authenticate to the intended npm account, then publish the same file that was inspected:

```sh
set -eu
: "${release_tarball:?Run the build-and-inspect block in this shell first.}"
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
test -f "$release_tarball"
npm publish "$release_tarball" --access public --registry=https://registry.npmjs.org
```

Keep authentication in npm's user-level configuration. npm handles any account authentication/2FA prompt in the terminal. Prefer the Release workflow for registry publication. Configure npm trusted publishing for `laststance/happy-dom-extended` on each public package, including the first `vitest-environment-happy-dom-extended` release, before merging a Version Packages PR. The local commands remain a fallback when CI cannot publish.

After publication, verify the registry version in the same shell:

```sh
set -eu
: "${release_version:?Run the build-and-inspect block in this shell first.}"
npm view "jest-happy-dom-extended@${release_version}" version dist.integrity --registry=https://registry.npmjs.org
```

Switch to a clean consumer project directory in that same shell, then install the verified version:

```sh
set -eu
: "${release_version:?Run the build-and-inspect block in this shell first.}"
npm install --save-dev jest@30 "jest-happy-dom-extended@${release_version}" --registry=https://registry.npmjs.org
```

Apply the same npm 12 approval and rebuild steps in that clean consumer before running the README's Jest example.

See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) for tarball and dry-run behavior. The root `pnpm run release` command also publishes through Changesets after validation; it is a publication command, not part of preparation.

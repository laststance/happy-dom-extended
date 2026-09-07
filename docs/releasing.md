# Manual npm release

The publishable package is `jest-happy-dom-extended` in `packages/jest-happy-dom-extended`. The repository root, compatibility workspace and reserved Vitest workspace are private. GitHub Actions validate changes and never publish them.

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

If the version/changelog changes are already included in the reviewed commit, skip the version command and run `pnpm check`. Confirm that the selected name/version has not already been published; npm cannot reuse an existing name/version. The version in `packages/jest-happy-dom-extended/package.json` determines the artifact name.

## Build and inspect the package

From the repository root:

```sh
mkdir -p .artifacts/release
pnpm --filter jest-happy-dom-extended pack --pack-destination .artifacts/release
```

The package's prepack script builds the public entry, declarations and private Worker bootstrap. The `files` allowlist includes only distribution files, the package guide, changelog and license, plus npm's mandatory package manifest. A separate `.npmignore` is unnecessary. Registry/access are set in the public package's publishConfig; project `.npmrc` credentials are unnecessary. [npm's file selection rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files) describe how the allowlist is applied.

Set the exact versioned artifact path and inspect it without publishing:

```sh
release_version="$(node -p "require('./packages/jest-happy-dom-extended/package.json').version")"
release_tarball=".artifacts/release/jest-happy-dom-extended-${release_version}.tgz"
tar -tzf "$release_tarball"
npm publish "$release_tarball" --dry-run --access public --registry=https://registry.npmjs.org
```

Expect `dist/index.cjs`, `dist/index.d.cts`, `dist/worker.cjs`, their build chunks, README, CHANGELOG, LICENSE and package.json. Repository tests, fixtures, local artifacts, credentials and workspace source directories must not appear. Distribution source maps may contain the public source used to build the package.

`pnpm check:package` checks package exports and type resolution. `pnpm test:package` installs a tarball outside the repository and runs both supported Jest versions, setup files, ESM/CommonJS lifetimes and actual Worker/video use in serial and two-process modes. `pnpm check` includes both commands.

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
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish "$release_tarball" --access public --registry=https://registry.npmjs.org
```

Keep authentication in npm's user-level configuration. npm handles any account authentication/2FA prompt in the terminal. This local manual workflow does not enable CI provenance; configure trusted publishing separately if automated releases become a requirement.

After publication, verify the registry version and install it in a clean consumer:

```sh
npm view "jest-happy-dom-extended@${release_version}" version dist.integrity --registry=https://registry.npmjs.org
npm install --save-dev jest@30 "jest-happy-dom-extended@${release_version}"
```

Apply the same npm 12 approval and rebuild steps in that clean consumer before running the README's Jest example.

See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) for tarball and dry-run behavior. The root `pnpm run release` command also publishes through Changesets after validation; it is a publication command, not part of preparation.

# Testing

Tests must prove real application behavior, including meaningful failure and cleanup paths. Source coverage is a useful signal, not proof of complete browser conformance.

## Commands

```sh
pnpm test              # Build, Node regressions, Jest/Vitest integration, c8 coverage
pnpm test:package      # Packs each package through prepack, then installs the tarballs
pnpm check             # Complete local gate
```

Use `pnpm test:unit`, `pnpm test:jest`, or `pnpm test:vitest` for focused iteration; build before runner suites when source changed. `pnpm test:coverage` is an alias for the coverage-producing test command. c8 collects V8 coverage from Node, Jest, and Vitest processes and remaps bundled code to source. Reports: `coverage/lcov.info` for Codecov and `coverage/coverage-final.json` for Fallow. Type-only source declarations can appear in V8's line accounting; don't equate the percentage with executable branch coverage.

## Test layers

| Layer                          | Location                                               | What it proves                                                                                                       |
| ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Node compatibility regressions | `packages/compat/test/*.test.ts`                       | Web API behavior, pixels, dimension resets, ownership, failure cleanup                                               |
| Source environment lifecycle   | `packages/*/test-node/*.test.mjs`                      | Constructor/factory options, pre-setup behavior and the Vitest global setup without a build boundary                 |
| Actual Jest VM                 | `packages/jest-happy-dom-extended/test/*.test.ts`      | VM arrays, setup APIs, fake timers, consumer spies                                                                   |
| Actual Vitest worker           | `packages/vitest-happy-dom-extended/test/**/*.test.ts` | Worker globals and execution context in every pool, `isolate: false`, fake timers, consumer spies                    |
| Installed packages             | `fixtures/consumer*/`, `scripts/test-package.mjs`      | Runtime dependencies, public exports, setupFiles evaluation, pool contexts, a React product, missing-binary guidance |

Installed-package tests run outside the workspace in dedicated temp directories. Their prefixes contain no spaces, but `os.tmpdir()` itself may. The generated manifest includes fixture-only verification dependencies, never a direct Canvas dependency that could hide a packaging omission. PNG output is independently decoded with pngjs. JSON reports require all expected suites/tests. Each Jest and Vitest version also runs environment lifecycle regressions. Packed Vitest setupFiles must construct Canvas/File at module evaluation.

Setup records prove where each runner executed setup. Jest `--runInBand` must stay in the CLI process, and its parallel mode must use two worker processes. Each Vitest record names its process, thread and VM context. `threads` and `vmThreads` must run on worker threads inside the CLI process. `forks` and `vmForks` must run in child processes, the VM pools must report a VM context, and two-worker modes must record two workers. A Vitest run also fails when its stderr mentions `vitest/environments`, which Vitest 4.1 deprecates and Vitest 5 removed.

Thread-pool runs configure Vitest the way the Vitest README tells `threads` and `vmThreads` users to. The harness sets `HAPPY_DOM_THREAD_POOL=1`, and the fixture configs then add `vitest-environment-happy-dom-extended/global-setup`, which loads skia-canvas in Vitest's main thread. Without it, Windows can unload skia-canvas's native binary under its own threads and crash the run; [Verification](docs/verification.md#windows-thread-pool-crash) records the experiments. The repository's own Vitest projects use the built global setup for the same pools. `forks` and `vmForks` runs keep the plain configuration most consumers use.

Node 25 and later define their own lazy `localStorage` and `sessionStorage` globals. Below Node 25, every Vitest run adds `--experimental-webstorage` to `NODE_OPTIONS`, so each CI cell has them too. Consumers must still receive the Window's storage in every pool, and a Node 25+ run fails when stderr shows Node's `localStorage` warning. Node 22 and 24 then print Node's experimental Web Storage warning once per process, because reading the `Storage` global's descriptor, as populateGlobal does, loads the flagged feature.

`fixtures/consumer-vitest-product` is a small React 19 application tested the way product teams test. It uses TSX through Vite, an `@` alias, a named project with globals and a setup file, Testing Library, user-event and jest-dom. Its eight tests read chart pixels and a PNG export, preview an uploaded image through createImageBitmap, confirm IME composition before searching, persist recent searches in localStorage and survive a corrupted entry, and sign out across tabs with BroadcastChannel. The three Canvas tests fail with Vitest's plain `happy-dom` environment. `pnpm test:package` installs it from the tarball in every pool; inside the workspace, run `pnpm --filter happy-dom-extended-vitest-product-fixture exec vitest run`.

The development versions of Jest and Vitest also hide skia-canvas's native binary after installation. The run must fail and print every approval command, which proves that both bundles explain a skipped install script. A second Vitest run uses `threads` with the global setup. It must fail in the global setup, before any worker starts, with the same commands.

CI tests Node 22.18.0, 24.20.0, and 26.8.1 on Linux and Windows with Jest 30.0.0 and 30.5.1 plus Vitest 4.0.0, 4.1.11 and 5.0.1 installed consumers. The Vitest 4.0.0 cell pins Vite 7.1.12; 4.0.0's module runner does not implement Vite 7.2+'s `getBuiltins`. Codecov receives one Linux Node 24 report to avoid duplicate matrix uploads. The upload always passes the organization token and sets `fail_ci_if_error`, and a fork PR cannot read that secret. Codecov's tokenless public-repository flow has not been exercised here; [TODOS.md](TODOS.md) tracks confirming it.

## Try an application before release

The fixtures cannot cover every project. To check a real application, install the packed tarball into a disposable copy of it, never into its working tree. A tarball install is more faithful than `pnpm link`, which resolves the environment's dependencies from this workspace.

```sh
pnpm build
pnpm --filter vitest-environment-happy-dom-extended pack --pack-destination /tmp/hde-pack
rsync -a --exclude node_modules /path/to/app/ /tmp/hde-trial/app/
cd /tmp/hde-trial/app
pnpm add -D /tmp/hde-pack/vitest-environment-happy-dom-extended-*.tgz
pnpm approve-builds skia-canvas
```

Set `environment: 'happy-dom-extended'` in the copy's Vitest config, and add `globalSetup: ['vitest-environment-happy-dom-extended/global-setup']` for the thread pools. Run the suite with `--pool=forks`, `--pool=threads`, `--pool=vmThreads` and `--pool=vmForks`, then run the same commands with `environment: 'happy-dom'`. A failure that also occurs with `happy-dom` belongs to the application or to Happy DOM. A failure that occurs only with this environment needs a regression test here. [Verification](docs/verification.md#real-application-trials) records the latest trials.

## Regression expectations

Use `test`, observable names, literal expected values, and Arrange/Act/Assert. Check actual RGBA pixels, dimensions, MIME type, and decoded output rather than object existence. Cover image snapshots during redraw/resize, same-value dimension assignments, setup ordering, simultaneous environments, and disposal after errors. Await asynchronous operations and close test-owned resources.

Use fault injection only to reach real error paths (encoder failure, callback exception, locked descriptor). Do not replace rendering with fixed-result mocks. Ordinary CI checks temporary image release and surviving environments; it does not depend on GC timing or a fixed RSS limit. Dedicated Worker tests execute actual Node threads and installed bootstrap files. Use a browser for layout, WebGL and behavior outside the [stated Canvas/Worker guarantees](docs/canvas-compatibility.md).

Image/video cancellation tests wait for a real HTTP request and keep its response open before replacing the source or closing the Window. Decoder cancellation tests hold an actual FFmpeg child's input open and observe its exit before a replacement decoder starts or teardown resolves. These barriers distinguish cancellation of running work from cancellation before an operation starts. Video tests need ffmpeg and ffprobe on PATH.

Rendering comparisons share `fixtures/canvas/render-cases.mjs` with a real browser page and a licensed, pinned Ahem font. Alpha and premultiplied RGB differences use the measured ceilings in [Canvas verification](docs/canvas-compatibility.md#reproduce-the-rendering-comparison). PNGJS independently decodes PNG output; FFmpeg independently decodes JPEG/WebP. Do not regenerate reference pixels to conceal a regression.

## Generated compatibility properties

`fast-check` is a development dependency of the workspaces that own these tests. The existing Node, Jest, and Vitest runners discover `property.test.ts` automatically; `pnpm test`, `pnpm check`, and every coverage matrix job execute the properties without a separate fuzzing command. It is neither a runtime dependency nor part of the published bundle.

| Property                        | Input budget per case                                                                              | Observable guarantee                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob / File                     | Two byte arrays of 0–64 bytes, 1–8 surrounding bytes on each side, slice bounds −256…256           | ArrayBuffer parts, subviews, nested and empty Blob/File inputs retain exactly their selected bytes; slices clamp correctly; `bytes()` copies are independent; FileReader reads the extended File                                          |
| Jest / Vitest worker ImageData  | 1–6 pixels per axis, 1–8 bytes of nonzero offset and suffix, matching opaque RGBA arrays           | ArrayBuffer and SharedArrayBuffer are allocated in the actual runner worker; data identity and shared storage survive mutations in both directions; drawing reads the correct subview                                                     |
| HTML / Offscreen dimensions     | 1–6 pixels per axis, 1–6 generated changes plus same-value resets on both axes                     | Assignment and HTML attribute mutation/removal clear pixels and state while preserving context identity; drawing at the far corner verifies the resized native bitmap                                                                     |
| PNG snapshots and empty exports | Two distinct opaque colors, at most two simultaneous exports, 1–6 pixels per axis or one zero axis | pngjs independently decodes invocation-time pixels and dimensions after redraw/resize; Happy DOM completion and environment cleanup deliver pending outputs; HTML empty exports notify asynchronously with null, Offscreen exports reject |

Each of the seven Node properties, two Jest VM properties, and two Vitest worker properties runs 50 cases with a fresh random seed: **550 generated cases per normal run**, plus shrinking on failure. A property has a 30-second runner timeout. Node properties complete in about 1.4 seconds locally on Node 24/macOS; the separate Jest command includes its environment/build startup overhead. CI timings also include existing regressions and installed consumers, so use the individual property durations when comparing overhead.

HTML attribute removal temporarily restores the browser's 300×150 defaults. The other axis remains at most 6 pixels, and each operation restores the generated dimensions: at most 1,800 transient pixels. Node properties reuse the regression Window/adapter setup and await complete cleanup in `finally` **for every case and every shrink**, including failed assertions. Jest properties release each native bitmap in `finally`; the runner owns its surrounding VM lifetime. Pending native output drains before Window shutdown and adapter disposal. No case depends on garbage collection or an RSS threshold.

Expected bytes come directly from generated input arrays; expected PNG pixels come from generated opaque colors, never from production Blob conversion or the renderer's decoder. Existing literal transparent/reset regressions remain. JPEG loss, font rasterization, and antialiasing are deliberately excluded from exact generated pixel equality.

### Focus and replay

```sh
# Fresh randomized runs of one layer.
node --test packages/compat/test/property.test.ts
pnpm test:jest --runTestsByPath packages/jest-happy-dom-extended/test/property.test.ts
pnpm test:vitest packages/vitest-happy-dom-extended/test/property.test.ts

# Copy seed and path from the failure, and select that one property's name.
FC_SEED=1245566333 FC_PATH='0:0:1:0:0:1:1:1:1:1:1:1' \
  node --test --test-name-pattern='^generated Blob' packages/compat/test/property.test.ts
FC_SEED=123 FC_PATH='0:1' pnpm test:jest \
  --runTestsByPath packages/jest-happy-dom-extended/test/property.test.ts \
  --testNamePattern='^generated Jest VM ImageData retains ArrayBuffer'
FC_SEED=123 FC_PATH='0:1' pnpm test:vitest \
  packages/vitest-happy-dom-extended/test/property.test.ts \
  -t 'generated Vitest worker ImageData retains ArrayBuffer'
```

The Jest seed/path above are placeholders; replace them with the failing report. `FC_PATH` enables `endOnFailure` for exact counterexample replay and requires the matching `FC_SEED`. Blank, non-numeric and non-finite seeds fail before generation instead of silently selecting a different case. Do not set either variable in ordinary CI or permanently fix a seed. On Windows PowerShell, assign `$env:FC_SEED` and `$env:FC_PATH` before the same command, then remove them afterward.

The Blob example was verified by temporarily asserting that a nonempty File has one byte less than its actual size. fast-check minimized it to an empty buffer part plus a one-byte `[0]` view inside `[0]` prefix/suffix padding. The original run closed all 21 created environments, and replay executed and closed exactly one environment with the identical counterexample. The intentional error and temporary counters were removed before commit; the correct property passes. This exercise proves shrinking/replay, not a library defect.

For a real failure, retain the seed, path, minimized counterexample, runner/Node versions, and failing assertion in the PR. Reproduce it before changing the implementation, add a named regression with literal inputs and expectations to the existing regression suite, fix the supported contract, and run both the replay and fresh randomized tests. See the [fast-check test-report guide](https://github.com/dubzzz/fast-check/blob/main/website/docs/tutorials/quick-start/read-test-reports.md). OpenSSF Scorecard's Fuzzing result is checked separately after merge; successful generated tests alone do not establish that its detector recognized them.

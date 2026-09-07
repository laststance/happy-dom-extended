# Testing

Tests must prove real application behavior, including meaningful failure and cleanup paths. Source coverage is a useful signal, not proof of complete browser conformance.

## Commands

```sh
pnpm test              # Build, Node regressions, Jest integration, c8 coverage
pnpm test:package      # Requires a current build; isolated installed-tarball checks
pnpm check             # Complete local gate
```

Use `pnpm test:unit` or `pnpm test:jest` for focused iteration; build before Jest when source changed. `pnpm test:coverage` is an alias for the coverage-producing test command. c8 collects V8 coverage from Node and Jest processes and remaps bundled code to source. Reports: `coverage/lcov.info` for Codecov and `coverage/coverage-final.json` for Fallow. Type-only source declarations can appear in V8's line accounting; don't equate the percentage with executable branch coverage.

## Test layers

| Layer                          | Location                                                | What it proves                                                                     |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Node compatibility regressions | `packages/compat/test/*.test.ts`                        | Web API behavior, pixels, dimension resets, ownership, failure cleanup             |
| Source environment lifecycle   | `packages/jest-happy-dom-extended/test-node/*.test.mjs` | Constructor options and pre-setup behavior without a build boundary                |
| Actual Jest VM                 | `packages/jest-happy-dom-extended/test/*.test.ts`       | VM arrays, setup APIs, fake timers, consumer spies                                 |
| Installed package              | `fixtures/consumer/` and `scripts/test-package.mjs`     | Runtime dependencies, public exports/types, module mixing, serial/parallel workers |

Installed-package tests run outside the workspace in a path containing spaces. The generated manifest includes fixture-only verification dependencies, never a direct Canvas dependency that could hide a packaging omission. PNG output is independently decoded with pngjs. JSON reports require all expected suites/tests, and setup records verify two real worker processes in parallel mode. Each Jest version also runs environment lifecycle regressions.

CI tests Node 22.18.0, 24.20.0, and 26.8.1 on Linux and Windows with Jest 30.0.0 and 30.5.1 installed consumers. Codecov receives one Linux Node 24 report to avoid duplicate matrix uploads. Fork PRs use Codecov's public-repository upload flow when the organization token is unavailable.

## Regression expectations

Use `test`, observable names, literal expected values, and Arrange/Act/Assert. Check actual RGBA pixels, dimensions, MIME type, and decoded output rather than object existence. Cover image snapshots during redraw/resize, same-value dimension assignments, setup ordering, simultaneous environments, and disposal after errors. Await asynchronous operations and close test-owned resources.

Use fault injection only to reach real error paths (encoder failure, callback exception, locked descriptor). Do not replace rendering with fixed-result mocks. Ordinary CI checks temporary image release and surviving environments; it does not depend on GC timing or a fixed RSS limit. Use a browser for layout, WebGL, Workers, animation frames, and browser rendering comparisons outside the stated guarantees.

## Generated compatibility properties

`fast-check` is a development dependency of the two workspaces that own these tests. The existing Node and Jest runners discover `property.test.ts` automatically; `pnpm test`, `pnpm check`, and every coverage matrix job execute the properties without a separate fuzzing command. It is neither a runtime dependency nor part of the published bundle.

| Property                        | Input budget per case                                                                              | Observable guarantee                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob / File                     | Two byte arrays of 0–64 bytes, 1–8 surrounding bytes on each side, slice bounds −256…256           | ArrayBuffer parts, subviews, nested and empty Blob/File inputs retain exactly their selected bytes; slices clamp correctly; `bytes()` copies are independent; FileReader reads the extended File                                          |
| Jest VM ImageData               | 1–6 pixels per axis, 1–8 bytes of nonzero offset and suffix, matching opaque RGBA arrays           | ArrayBuffer and SharedArrayBuffer are allocated in the actual Jest VM; data identity and shared storage survive mutations in both directions; drawing reads the correct subview                                                           |
| HTML / Offscreen dimensions     | 1–6 pixels per axis, 1–6 generated changes plus same-value resets on both axes                     | Assignment and HTML attribute mutation/removal clear pixels and state while preserving context identity; drawing at the far corner verifies the resized native bitmap                                                                     |
| PNG snapshots and empty exports | Two distinct opaque colors, at most two simultaneous exports, 1–6 pixels per axis or one zero axis | pngjs independently decodes invocation-time pixels and dimensions after redraw/resize; Happy DOM completion and environment cleanup deliver pending outputs; HTML empty exports notify asynchronously with null, Offscreen exports reject |

Each of the seven Node properties and two Jest VM properties runs 50 cases with a fresh random seed: **450 generated cases per normal run**, plus shrinking on failure. A property has a 30-second runner timeout. Node properties complete in about 1.4 seconds locally on Node 24/macOS; the separate Jest command includes its environment/build startup overhead. CI timings also include existing regressions and installed consumers, so use the individual property durations when comparing overhead.

HTML attribute removal temporarily restores the browser's 300×150 defaults. The other axis remains at most 6 pixels, and each operation restores the generated dimensions: at most 1,800 transient pixels. Node properties reuse the regression Window/adapter setup and await complete cleanup in `finally` **for every case and every shrink**, including failed assertions. Jest properties release each native bitmap in `finally`; the runner owns its surrounding VM lifetime. Pending native output drains before Window shutdown and adapter disposal. No case depends on garbage collection or an RSS threshold.

Expected bytes come directly from generated input arrays; expected PNG pixels come from generated opaque colors, never from production Blob conversion or the renderer's decoder. Existing literal transparent/reset regressions remain. JPEG loss, font rasterization, and antialiasing are deliberately excluded from exact generated pixel equality.

### Focus and replay

```sh
# Fresh randomized runs of one layer.
node --test packages/compat/test/property.test.ts
pnpm test:jest --runTestsByPath packages/jest-happy-dom-extended/test/property.test.ts

# Copy seed and path from the failure, and select that one property's name.
FC_SEED=1245566333 FC_PATH='0:0:1:0:0:1:1:1:1:1:1:1' \
  node --test --test-name-pattern='^generated Blob' packages/compat/test/property.test.ts
FC_SEED=123 FC_PATH='0:1' pnpm test:jest \
  --runTestsByPath packages/jest-happy-dom-extended/test/property.test.ts \
  --testNamePattern='^generated Jest VM ImageData retains ArrayBuffer'
```

The Jest seed/path above are placeholders; replace them with the failing report. `FC_PATH` enables `endOnFailure` for exact counterexample replay. Do not set either variable in ordinary CI or permanently fix a seed. On Windows PowerShell, assign `$env:FC_SEED` and `$env:FC_PATH` before the same command, then remove them afterward.

The Blob example was verified by temporarily asserting that a nonempty File has one byte less than its actual size. fast-check minimized it to an empty buffer part plus a one-byte `[0]` view inside `[0]` prefix/suffix padding. The original run closed all 21 created environments, and replay executed and closed exactly one environment with the identical counterexample. The intentional error and temporary counters were removed before commit; the correct property passes. This exercise proves shrinking/replay, not a library defect.

For a real failure, retain the seed, path, minimized counterexample, runner/Node versions, and failing assertion in the PR. Reproduce it before changing the implementation, add a named regression with literal inputs and expectations to the existing regression suite, fix the supported contract, and run both the replay and fresh randomized tests. See the [fast-check test-report guide](https://github.com/dubzzz/fast-check/blob/main/website/docs/tutorials/quick-start/read-test-reports.md). OpenSSF Scorecard's Fuzzing result is checked separately after merge; successful generated tests alone do not establish that its detector recognized them.

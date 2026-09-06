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

# TODOs

Tracked follow-ups that are out of scope for `vitest-environment-happy-dom-extended` 0.1.0.

## Vitest environment

### Claim the Vitest vmForks pool

**What:** Claim and test the Vitest `vmForks` pool for `vitest-environment-happy-dom-extended`.

**Why:** 0.1.0 only promises `forks` and covered `vmThreads`. Consumers who set `vmForks` have no owned proof.

**Context:** Keep the default pool as `forks`. Add `setupVM` coverage on `vmForks` only after the 0.1.0 environment is stable on `forks` and `vmThreads`.

**Effort:** M
**Priority:** P3
**Depends on:** 0.1.0 published and used on `forks`

### Investigate Vitest threads plus Skia

**What:** Investigate Vitest `threads` plus Skia native-module constraints.

**Why:** Advertising `threads` before owned Canvas and Worker tests pass can silently corrupt pixels.

**Context:** Skia is process-scoped. `pool: 'threads'` shares native state across test files. Do not advertise `threads` until owned Canvas and Worker tests pass on that pool.

**Effort:** L
**Priority:** P3
**Depends on:** None

## Completed

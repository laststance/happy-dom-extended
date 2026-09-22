import assert from 'node:assert/strict'
import { test } from 'node:test'

import { populateGlobal as runtimePopulateGlobal } from 'vitest/runtime'

import { importPopulateGlobal } from '../src/populate-global.ts'

test('Vitest 4.1+ and 5 load populateGlobal from vitest/runtime without evaluating the deprecated entry', async () => {
  // Arrange
  const runtimeExport = () => ({ keys: new Set() })
  const requestedEntries = []
  // Act
  const populateGlobal = await importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    return { populateGlobal: runtimeExport }
  })
  // Assert
  assert.equal(populateGlobal, runtimeExport)
  assert.deepEqual(requestedEntries, ['vitest/runtime'])
})

test('Vitest 4.0 installs without vitest/runtime fall back to vitest/environments', async () => {
  // Arrange
  const legacyExport = () => ({ keys: new Set() })
  const requestedEntries = []
  // Act
  const populateGlobal = await importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    if (specifier === 'vitest/runtime') {
      throw Object.assign(
        new Error(
          `Package subpath './runtime' is not defined by "exports" in /consumer/node_modules/vitest/package.json imported from /consumer/node_modules/vitest-environment-happy-dom-extended/dist/index.mjs`,
        ),
        { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
      )
    }
    return { populateGlobal: legacyExport }
  })
  // Assert
  assert.equal(populateGlobal, legacyExport)
  assert.deepEqual(requestedEntries, ['vitest/runtime', 'vitest/environments'])
})

test("A linked environment on Vitest 4.0 treats Vite's code-less missing-export error as an absent entry", async () => {
  // Arrange
  const legacyExport = () => ({ keys: new Set() })
  const requestedEntries = []
  // Act
  const populateGlobal = await importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    if (specifier === 'vitest/runtime') {
      // Vite's resolver raises this message without Node's error code when it inlines a symlinked environment.
      throw new Error(
        `Package subpath './runtime' is not defined by "exports" in /consumer/node_modules/vitest/package.json.`,
      )
    }
    return { populateGlobal: legacyExport }
  })
  // Assert
  assert.equal(populateGlobal, legacyExport)
  assert.deepEqual(requestedEntries, ['vitest/runtime', 'vitest/environments'])
})

test('A failing vitest/runtime module surfaces its own error instead of silently loading the deprecated entry', async () => {
  // Arrange
  const evaluationError = new TypeError('vitest/runtime evaluation failed')
  const requestedEntries = []
  // Act
  const loading = importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    throw evaluationError
  })
  // Assert
  await assert.rejects(loading, (error) => error === evaluationError)
  assert.deepEqual(requestedEntries, ['vitest/runtime'])
})

test('A Vitest without either entry reports both resolution failures with an install hint', async () => {
  // Arrange
  const runtimeMissing = Object.assign(new Error('runtime is not exported'), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  })
  const environmentsMissing = Object.assign(
    new Error('environments is not exported'),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
  )
  // Act
  const loading = importPopulateGlobal(async (specifier) => {
    throw specifier === 'vitest/runtime' ? runtimeMissing : environmentsMissing
  })
  // Assert
  await assert.rejects(loading, (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [runtimeMissing, environmentsMissing])
    assert.equal(
      error.message,
      'The installed Vitest exposes neither vitest/runtime nor vitest/environments. Install Vitest 4 or 5.',
    )
    return true
  })
})

test('A Vitest entry without populateGlobal fails with an actionable TypeError', async () => {
  // Arrange
  const entryWithoutPopulateGlobal = { builtinEnvironments: {} }
  // Act
  const loading = importPopulateGlobal(async () => entryWithoutPopulateGlobal)
  // Assert
  await assert.rejects(loading, {
    name: 'TypeError',
    message: 'vitest/runtime does not export populateGlobal.',
  })
})

test('The development Vitest 5 resolves the same populateGlobal that vitest/runtime exports', async () => {
  // Act
  const populateGlobal = await importPopulateGlobal()
  // Assert
  assert.equal(populateGlobal, runtimePopulateGlobal)
})

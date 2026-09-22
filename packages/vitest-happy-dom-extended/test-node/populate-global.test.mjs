import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { populateGlobal as runtimePopulateGlobal } from 'vitest/runtime'

import {
  importPopulateGlobal,
  populateWindowGlobals,
} from '../src/populate-global.ts'

/** Builds the missing-export message Node and Vite report for a subpath absent from a package's `exports`.
 * @param subpath - Requested subpath, such as `./runtime`.
 * @param manifest - package.json path named by the resolver.
 * @returns An Error carrying Node's ERR_PACKAGE_PATH_NOT_EXPORTED code.
 * @example missingExportError('./runtime', '/consumer/node_modules/vitest/package.json')
 */
function missingExportError(subpath, manifest) {
  return Object.assign(
    new Error(
      `Package subpath '${subpath}' is not defined by "exports" in ${manifest}`,
    ),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
  )
}

/** Builds a worker-global stand-in with Node's lazy Web Storage accessors and logs every getter call.
 * `localStorage` throws like Node 22/24 --experimental-webstorage without --localstorage-file; Node 25+ warns instead.
 * @returns The sandbox global and the names of the getters that ran.
 * @example const { sandbox, getterReads } = createNodeWebStorageGlobal()
 */
function createNodeWebStorageGlobal() {
  const getterReads = []
  const sandbox = Object.create(null)
  Object.defineProperty(sandbox, 'localStorage', {
    configurable: true,
    enumerable: false,
    get() {
      getterReads.push('localStorage')
      throw new TypeError(
        "The argument '--localstorage-file' is an invalid localStorage location. Received ''",
      )
    },
  })
  Object.defineProperty(sandbox, 'sessionStorage', {
    configurable: true,
    enumerable: true,
    get() {
      getterReads.push('sessionStorage')
      return { nodeSessionStorage: true }
    },
  })
  return { sandbox, getterReads }
}

/** Mirrors Vitest 4.0-4.1 populateGlobal for the keys it is given: an overridden key already on the global is read by value
 * (`originals.set(key, global[key])`) before the Window getter replaces it. Vitest 4 is not installed in this workspace.
 * @returns The keys it defined.
 * @example vitest4PopulateGlobal(sandbox, window, { additionalKeys: ['fetch'] })
 */
function vitest4PopulateGlobal(global, window, { additionalKeys = [] }) {
  const keys = new Set(additionalKeys)
  for (const key of keys) {
    if (key in global) Reflect.get(global, key)
    Object.defineProperty(global, key, {
      configurable: true,
      get: () => window[key],
    })
  }
  return { keys }
}

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

test('Vitest 4.0 on Windows falls back when Node names the manifest with backslashes', async () => {
  // Arrange
  const legacyExport = () => ({ keys: new Set() })
  const requestedEntries = []
  // Act
  const populateGlobal = await importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    if (specifier === 'vitest/runtime') {
      throw missingExportError(
        './runtime',
        'C:\\consumer\\node_modules\\vitest\\package.json',
      )
    }
    return { populateGlobal: legacyExport }
  })
  // Assert
  assert.equal(populateGlobal, legacyExport)
  assert.deepEqual(requestedEntries, ['vitest/runtime', 'vitest/environments'])
})

test("A dependency's missing export inside vitest/runtime surfaces instead of loading the deprecated entry", async () => {
  // Arrange
  const dependencyMissing = missingExportError(
    './runtime',
    '/consumer/node_modules/@vitest/runner/package.json',
  )
  const requestedEntries = []
  // Act
  const loading = importPopulateGlobal(async (specifier) => {
    requestedEntries.push(specifier)
    throw dependencyMissing
  })
  // Assert
  await assert.rejects(loading, (error) => error === dependencyMissing)
  assert.deepEqual(requestedEntries, ['vitest/runtime'])
})

test('A Vitest without either entry reports both resolution failures with an install hint', async () => {
  // Arrange
  const runtimeMissing = missingExportError(
    './runtime',
    '/consumer/node_modules/vitest/package.json',
  )
  const environmentsMissing = missingExportError(
    './environments',
    '/consumer/node_modules/vitest/package.json',
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

test("Vitest 4 tests get the Window's localStorage and sessionStorage without running Node's Web Storage getters", async () => {
  // Arrange
  const { sandbox, getterReads } = createNodeWebStorageGlobal()
  const window = new Window()
  try {
    // Act
    const keys = populateWindowGlobals(sandbox, window, vitest4PopulateGlobal)
    // Assert
    assert.deepEqual(getterReads, [])
    assert.equal(sandbox.localStorage, window.localStorage)
    assert.equal(sandbox.sessionStorage, window.sessionStorage)
    assert.equal(keys.has('localStorage'), true)
    assert.equal(keys.has('sessionStorage'), true)
  } finally {
    await window.happyDOM.close()
  }
})

test("Vitest 5 tests get the Window's localStorage and sessionStorage without running Node's Web Storage getters", async () => {
  // Arrange
  const { sandbox, getterReads } = createNodeWebStorageGlobal()
  const window = new Window()
  try {
    // Act
    const keys = populateWindowGlobals(sandbox, window, runtimePopulateGlobal)
    // Assert
    assert.deepEqual(getterReads, [])
    assert.equal(sandbox.localStorage, window.localStorage)
    assert.equal(sandbox.sessionStorage, window.sessionStorage)
    assert.equal(keys.has('localStorage'), true)
    assert.equal(keys.has('sessionStorage'), true)
  } finally {
    await window.happyDOM.close()
  }
})

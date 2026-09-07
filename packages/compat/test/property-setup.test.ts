import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { Window } from 'happy-dom'

import { ExtendedCanvasAdapter } from '../src/index.ts'

import { renderingWindow } from './utils/rendering-window.ts'

test('property replay rejects invalid seeds and paths without their matching seed', () => {
  // Arrange: isolate imports so an invalid replay cannot poison this test runner.
  const environment = { ...process.env }
  delete environment.FC_SEED
  delete environment.FC_PATH
  const moduleURL = new URL('./constants.ts', import.meta.url).href
  const script = `const { PROPERTY_PARAMETERS } = await import(${JSON.stringify(moduleURL)}); console.log(JSON.stringify(PROPERTY_PARAMETERS))`

  for (const replay of [
    { FC_SEED: '' },
    { FC_SEED: ' ' },
    { FC_SEED: 'typo' },
    { FC_SEED: 'NaN' },
    { FC_SEED: 'Infinity' },
    { FC_PATH: '0:0' },
  ]) {
    // Act
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        encoding: 'utf8',
        env: { ...environment, ...replay },
      },
    )
    // Assert
    assert.equal(result.status, 1)
    assert.match(result.stderr, /FC_SEED/)
  }

  // Act: both ordinary randomized runs and exact replay retain their configuration.
  const ordinary = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      encoding: 'utf8',
      env: environment,
    },
  )
  const replay = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    {
      encoding: 'utf8',
      env: { ...environment, FC_SEED: '1245566333', FC_PATH: '0:0' },
    },
  )
  // Assert
  assert.equal(ordinary.status, 0)
  assert.deepEqual(JSON.parse(ordinary.stdout), { numRuns: 50 })
  assert.equal(replay.status, 0)
  assert.deepEqual(JSON.parse(replay.stdout), {
    numRuns: 50,
    seed: 1245566333,
    path: '0:0',
    endOnFailure: true,
  })
})

test('property Window construction failure still disposes its adapter', async (context) => {
  // Arrange: reject Happy DOM settings before it can construct a Window.
  const setupError = new Error('Window construction failed')
  const objectKeys = Object.keys
  const dispose = context.mock.method(
    ExtendedCanvasAdapter.prototype,
    'dispose',
  )
  context.mock.method(Object, 'keys', (value: object) => {
    if (Reflect.get(value, 'canvasAdapter') instanceof ExtendedCanvasAdapter) {
      throw setupError
    }
    return objectKeys(value)
  })

  // Act / Assert
  await assert.rejects(renderingWindow(), (error) => error === setupError)
  assert.equal(dispose.mock.callCount(), 1)
})

for (const cleanupFails of [false, true]) {
  test(`failed property setup closes its Window and adapter${cleanupFails ? ' and preserves cleanup failures' : ''}`, async (context) => {
    // Arrange: fail real compatibility installation after Window construction.
    const setupError = new Error('Setup failed')
    const windowError = new Error('Window cleanup failed')
    const adapterError = new Error('Adapter cleanup failed')
    const defineProperty = Object.defineProperty
    const disposeAdapter = ExtendedCanvasAdapter.prototype.dispose
    let windowClosed = false
    let adapterDisposed = false
    context.mock.method(
      ExtendedCanvasAdapter.prototype,
      'dispose',
      function (this: ExtendedCanvasAdapter) {
        disposeAdapter.call(this)
        adapterDisposed = true
        if (cleanupFails) throw adapterError
      },
    )
    context.mock.method(
      Object,
      'defineProperty',
      (target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
        if (target instanceof Window && key === 'structuredClone') {
          const closeWindow = target.happyDOM.close.bind(target.happyDOM)
          context.mock.method(target.happyDOM, 'close', async () => {
            await closeWindow()
            windowClosed = true
            if (cleanupFails) throw windowError
          })
          throw setupError
        }
        return defineProperty(target, key, descriptor)
      },
    )

    // Act / Assert
    await assert.rejects(renderingWindow(), (error: unknown) => {
      if (cleanupFails) {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.cause, setupError)
        assert.deepEqual(error.errors, [setupError, windowError, adapterError])
      } else assert.equal(error, setupError)
      return true
    })
    assert.equal(windowClosed, true)
    assert.equal(adapterDisposed, true)
  })
}

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ExtendedCanvasAdapter,
  prepareOwnedCanvasSettings,
} from '../src/index.ts'

test('prepareOwnedCanvasSettings defaults enableImageFileLoading and owns a native adapter', () => {
  // Arrange / Act
  const prepared = prepareOwnedCanvasSettings(undefined)
  try {
    // Assert
    assert.equal(prepared.settings.enableImageFileLoading, true)
    assert.ok(prepared.adapter instanceof ExtendedCanvasAdapter)
    assert.equal(prepared.settings.canvasAdapter, prepared.adapter)
  } finally {
    prepared.adapter?.dispose()
  }
})

test('prepareOwnedCanvasSettings preserves an explicit image-loading opt-out on a frozen object', () => {
  // Arrange
  const supplied = Object.freeze({ enableImageFileLoading: false })
  // Act
  const prepared = prepareOwnedCanvasSettings(supplied)
  try {
    // Assert
    assert.equal(prepared.settings.enableImageFileLoading, false)
    assert.equal(Object.hasOwn(supplied, 'canvasAdapter'), false)
    assert.ok(prepared.adapter instanceof ExtendedCanvasAdapter)
  } finally {
    prepared.adapter?.dispose()
  }
})

test('prepareOwnedCanvasSettings rejects a serialized empty adapter object', () => {
  // Arrange / Act / Assert
  assert.throws(
    () => prepareOwnedCanvasSettings({ canvasAdapter: {} }),
    /cannot serialize adapter instances/,
  )
})

test('prepareOwnedCanvasSettings rejects non-object settings', () => {
  // Arrange / Act / Assert
  assert.throws(
    () => prepareOwnedCanvasSettings(false),
    /settings must be an object/,
  )
})

test('prepareOwnedCanvasSettings rejects an array so numeric keys never become Window settings', () => {
  // Arrange / Act / Assert
  assert.throws(
    () => prepareOwnedCanvasSettings([{ enableImageFileLoading: false }]),
    /settings must be an object/,
  )
})

test('prepareOwnedCanvasSettings leaves a caller-owned adapter undisposed', () => {
  // Arrange
  const adapter = {
    getContext() {
      return null
    },
    toDataURL() {
      return ''
    },
    toBlob(_caller: unknown, callback: (blob: null) => void) {
      callback(null)
    },
  }
  // Act
  const prepared = prepareOwnedCanvasSettings({ canvasAdapter: adapter })
  // Assert
  assert.equal(prepared.adapter, undefined)
  assert.equal(prepared.settings.canvasAdapter, adapter)
  assert.equal(prepared.settings.enableImageFileLoading, true)
})

test('prepareOwnedCanvasSettings treats null settings as empty and still owns an adapter', () => {
  // Arrange / Act
  const prepared = prepareOwnedCanvasSettings(null)
  try {
    // Assert
    assert.equal(prepared.settings.enableImageFileLoading, true)
    assert.ok(prepared.adapter instanceof ExtendedCanvasAdapter)
    assert.equal(prepared.settings.canvasAdapter, prepared.adapter)
  } finally {
    prepared.adapter?.dispose()
  }
})

test('prepareOwnedCanvasSettings leaves an explicit null adapter to the caller', () => {
  // Arrange / Act
  const prepared = prepareOwnedCanvasSettings({ canvasAdapter: null })
  // Assert
  assert.equal(prepared.adapter, undefined)
  assert.equal(prepared.settings.canvasAdapter, null)
  assert.equal(prepared.settings.enableImageFileLoading, true)
})

test('prepareOwnedCanvasSettings uses runner-supplied TypeError wording', () => {
  // Arrange / Act / Assert
  assert.throws(
    () =>
      prepareOwnedCanvasSettings(false, {
        settings: 'environmentOptions.settings must be an object.',
      }),
    { message: 'environmentOptions.settings must be an object.' },
  )
  assert.throws(
    () =>
      prepareOwnedCanvasSettings(
        { canvasAdapter: 1 },
        {
          adapter:
            'canvasAdapter must implement getContext, toDataURL, and toBlob.',
        },
      ),
    {
      message:
        'canvasAdapter must implement getContext, toDataURL, and toBlob.',
    },
  )
})

test('prepareOwnedCanvasSettings rejects an adapter missing toBlob', () => {
  // Arrange / Act / Assert
  assert.throws(
    () =>
      prepareOwnedCanvasSettings({
        canvasAdapter: {
          getContext() {
            return null
          },
          toDataURL() {
            return ''
          },
        },
      }),
    /cannot serialize adapter instances/,
  )
})

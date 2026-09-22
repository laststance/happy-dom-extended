import { isMainThread } from 'node:worker_threads'

import { expect, inject, test } from 'vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    pool: 'forks' | 'threads' | 'vmThreads' | 'vmForks'
  }
}

// Each supported pool has a distinct execution context; a misconfigured project would silently fall back to forks.
const expectedExecutionContexts = {
  forks: { workerThread: false, vmContext: false },
  threads: { workerThread: true, vmContext: false },
  vmThreads: { workerThread: true, vmContext: true },
  vmForks: { workerThread: false, vmContext: true },
}

test('each supported Vitest pool runs the environment in its real execution context and paints real Canvas pixels', () => {
  // Arrange
  const pool = inject('pool')
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const drawing = canvas.getContext('2d')!
  // Act
  drawing.fillStyle = 'red'
  drawing.fillRect(0, 0, 1, 1)
  // Assert
  expect({
    workerThread: !isMainThread,
    vmContext: process.env.VITEST_VM_POOL === '1',
  }).toEqual(expectedExecutionContexts[pool])
  expect([...drawing.getImageData(0, 0, 1, 1).data]).toEqual([255, 0, 0, 255])
  expect(window.location.href).toBe('http://localhost:3000/')
})

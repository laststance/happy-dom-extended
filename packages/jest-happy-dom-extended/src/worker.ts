import { startOwnedWorker } from '../../compat/src/workers/worker-runtime.ts'

startOwnedWorker().catch((error: unknown) => {
  // Surface early bootstrap failures through the native Worker's error/exit events even with relaxed rejection handling.
  setImmediate(() => {
    throw error
  })
})

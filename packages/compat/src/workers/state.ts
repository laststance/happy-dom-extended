import type { Worker } from 'node:worker_threads'

// Internal ownership evidence lets lifecycle tests observe actual thread exit without adding a public API.
export const workerThreads = new WeakMap<object, Worker>()

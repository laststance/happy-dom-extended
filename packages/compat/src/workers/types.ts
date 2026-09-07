import type { MessagePort } from 'node:worker_threads'

/** Private bootstrap data crosses only our native Worker constructor boundary, never a public script message. */
export interface WorkerStartupData {
  messages: MessagePort
  requests: MessagePort
  control: MessagePort
  wake: Int32Array<SharedArrayBuffer>
  token: string
  url: string
  origin: string
  type: 'classic' | 'module'
  name: string
  bootstrap: string
}

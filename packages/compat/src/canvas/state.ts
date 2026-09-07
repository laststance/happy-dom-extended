import type { MessagePort } from 'node:worker_threads'

import type {
  ICanvasAdapterCaller,
  ICanvasShape,
  ImageBitmap,
  ImageData,
  OffscreenCanvas,
} from 'happy-dom'

import type { ExtendedCanvasAdapter } from './adapter.ts'
import type { imageDataSettings } from './image-data-settings.ts'
import type { CanvasState } from './types.ts'

// Shared identity lets dimension hooks and other environments find the actual owner after DOM adoption.
export const canvasStates = new WeakMap<ICanvasShape, CanvasState>()
export const canvasWindows = new WeakMap<
  ICanvasAdapterCaller['window'],
  ExtendedCanvasAdapter
>()
export const patternOrigins = new WeakMap<object, boolean>()
export const bitmapStates = new WeakMap<ImageBitmap, CanvasState>()
export const imageDataColorSpaces = new WeakMap<
  ImageData,
  ReturnType<typeof imageDataSettings>['colorSpace']
>()
export const detachedOffscreens = new WeakSet<OffscreenCanvas>()
export const offscreenDimensions = new WeakMap<
  OffscreenCanvas,
  { width: number; height: number }
>()
export const canvasPortTokens = new WeakMap<MessagePort, string>()
export const canvasPortInstallers = new WeakMap<
  ICanvasAdapterCaller['window'],
  (port: MessagePort, token: string) => void
>()

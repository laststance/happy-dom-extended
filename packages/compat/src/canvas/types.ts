import type { ICanvasAdapterCaller, ICanvasRenderingContext2D } from 'happy-dom'
import type { Canvas, CanvasRenderingContext2D } from 'skia-canvas'

import type { DisposeCompatibility } from '../types.ts'

import type { contextSettings } from './settings.ts'

export type CanvasMethod = (...argumentsList: unknown[]) => unknown

/** Keeps one DOM owner, native bitmap, and stable context together until that owner is collected. */
export interface CanvasState {
  caller: ICanvasAdapterCaller
  bitmap: Canvas
  nativeContext: CanvasRenderingContext2D
  readPixels: CanvasRenderingContext2D['getImageData']
  writePixels: CanvasRenderingContext2D['putImageData']
  reserveStorage: (bytes: number) => DisposeCompatibility
  context: ICanvasRenderingContext2D | null
  width: number
  height: number
  originClean: boolean
  unavailable: boolean
  settings: ReturnType<typeof contextSettings>
  reset: () => void
  restorers: DisposeCompatibility[]
}

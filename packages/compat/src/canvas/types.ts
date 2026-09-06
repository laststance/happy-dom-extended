import type { Canvas } from 'canvas'
import type { ICanvasAdapterCaller, ICanvasRenderingContext2D } from 'happy-dom'

import type { DisposeCompatibility } from '../types.ts'

/** Keeps one DOM owner, native bitmap, and stable context together until that owner is collected. */
export interface CanvasState {
  caller: ICanvasAdapterCaller
  bitmap: Canvas
  context: ICanvasRenderingContext2D
  restorers: DisposeCompatibility[]
}

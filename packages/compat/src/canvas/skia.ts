import type * as SkiaCanvas from 'skia-canvas'

import { loadSkiaCanvas } from './load-skia-canvas.ts'

// Every Canvas module shares this one instance, so a missing native binary fails environment loading with install guidance.
const skiaCanvas = loadSkiaCanvas()

// Each class keeps skia-canvas's value; the Canvas modules also annotate with the Canvas, Image and ImageData instance types.
export const Canvas = skiaCanvas.Canvas
export type Canvas = SkiaCanvas.Canvas
export const CanvasGradient = skiaCanvas.CanvasGradient
export const CanvasPattern = skiaCanvas.CanvasPattern
export const DOMMatrix = skiaCanvas.DOMMatrix
export const Image = skiaCanvas.Image
export type Image = SkiaCanvas.Image
export const ImageData = skiaCanvas.ImageData
export type ImageData = SkiaCanvas.ImageData
export const Path2D = skiaCanvas.Path2D

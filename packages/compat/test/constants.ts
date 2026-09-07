// Keep generated native allocations and shrinking small enough for every CI platform.
const PROPERTY_RUNS = 50
export const PROPERTY_TIMEOUT_MS = 30_000
export const MAX_BINARY_BYTES = 64
export const MAX_PADDING_BYTES = 8
export const MAX_CANVAS_SIDE_PX = 6
export const MAX_RESIZE_STEPS = 6
export const RGBA_CHANNELS = 4
export const MAX_CHANNEL_VALUE = 255
export const MAX_SLICE_BOUNDARY_BYTES = MAX_BINARY_BYTES * 4

// Ordinary runs choose a fresh seed; a reported path replays only its minimized failure.
export const PROPERTY_PARAMETERS = {
  numRuns: PROPERTY_RUNS,
  ...(process.env.FC_SEED === undefined
    ? {}
    : { seed: Number(process.env.FC_SEED) }),
  ...(process.env.FC_PATH === undefined
    ? {}
    : { path: process.env.FC_PATH, endOnFailure: true }),
}

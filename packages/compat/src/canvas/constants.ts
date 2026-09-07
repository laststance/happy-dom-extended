export const NATIVE_CANVAS = Symbol('nativeCanvas')
export const CANVAS_DIMENSIONS = ['width', 'height'] as const
export const EMPTY_IMAGE_DATA_URL = 'data:,'
export const PNG_MIME_TYPE = 'image/png'
export const JPEG_MIME_TYPE = 'image/jpeg'
export const WEBP_MIME_TYPE = 'image/webp'
export const ENCODER_FORMATS = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
} as const
export const MIN_ENCODER_QUALITY = 0
export const MAX_ENCODER_QUALITY = 1
export const MIN_NATIVE_SIZE_PX = 0
export const DEFAULT_CANVAS_WIDTH_PX = 300
export const DEFAULT_CANVAS_HEIGHT_PX = 150
export const MAX_CANVAS_DIMENSION_PX = 32_767
export const MAX_CANVAS_PIXELS = 16_777_216
export const MAX_NATIVE_STORAGE_BYTES = 128 * 1024 * 1024
export const MAX_PENDING_CANVAS_MESSAGES = 64
export const RGBA_BYTES_PER_PIXEL = 4
export const MAX_COLOR_CHANNEL = 255
export const MAX_HTML_DIMENSION_PX = 2_147_483_647
export const MAX_MEDIA_INPUT_BYTES = 64 * 1024 * 1024
export const MAX_MEDIA_REDIRECTS = 20
export const MEDIA_OPERATION_TIMEOUT_MS = 30_000
export const MAX_MEDIA_METADATA_BYTES = 64 * 1024
export const MAX_MEDIA_PROCESSES = 4
export const VIDEO_FRAME_INTERVAL_MS = 50
export const MILLISECONDS_PER_SECOND = 1000
export const VIDEO_TIMESTAMP_EPSILON_SECONDS = 0.000001
export const RIGHT_ANGLE_DEGREES = 90
export const HALF_TURN_DEGREES = 180
export const MEDIA_HAVE_NOTHING = 0
export const MEDIA_HAVE_METADATA = 1
export const MEDIA_HAVE_ENOUGH_DATA = 4
export const MEDIA_NETWORK_EMPTY = 0
export const MEDIA_NETWORK_IDLE = 1
export const MEDIA_NETWORK_LOADING = 2
export const MEDIA_NETWORK_NO_SOURCE = 3
export const MEDIA_ERR_NETWORK = 2
export const MEDIA_ERR_DECODE = 3
export const MEDIA_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
export const CANVAS_NUMERIC_ARGUMENTS: Readonly<Record<string, number>> = {
  scale: 2,
  rotate: 1,
  translate: 2,
  transform: 6,
  clearRect: 4,
  fillRect: 4,
  strokeRect: 4,
  moveTo: 2,
  lineTo: 2,
  quadraticCurveTo: 4,
  bezierCurveTo: 6,
  arcTo: 5,
  rect: 4,
  roundRect: 4,
  arc: 5,
  ellipse: 7,
  createLinearGradient: 4,
  createRadialGradient: 6,
  createConicGradient: 3,
}
export const CANVAS_RADIUS_ARGUMENTS: Readonly<
  Record<string, readonly number[]>
> = {
  arcTo: [4],
  arc: [2],
  ellipse: [2, 3],
  createRadialGradient: [2, 5],
}
export const MATRIX_COMPONENTS = [
  ['a', 'm11', 1],
  ['b', 'm12', 0],
  ['c', 'm21', 0],
  ['d', 'm22', 1],
  ['e', 'm41', 0],
  ['f', 'm42', 0],
] as const
export const MAX_ROUND_RECT_RADII = 4
export const CANVAS_NUMERIC_PROPERTIES = new Set([
  'globalAlpha',
  'lineWidth',
  'miterLimit',
  'lineDashOffset',
  'shadowOffsetX',
  'shadowOffsetY',
  'shadowBlur',
])
export const CANVAS_STRING_PROPERTIES = new Set([
  'globalCompositeOperation',
  'filter',
  'font',
  'letterSpacing',
  'wordSpacing',
  'lang',
])
export const CANVAS_ENUM_PROPERTIES: Readonly<
  Record<string, readonly string[]>
> = {
  lineCap: ['butt', 'round', 'square'],
  lineJoin: ['round', 'bevel', 'miter'],
  textAlign: ['start', 'end', 'left', 'right', 'center'],
  textBaseline: [
    'top',
    'hanging',
    'middle',
    'alphabetic',
    'ideographic',
    'bottom',
  ],
  direction: ['ltr', 'rtl', 'inherit'],
  imageSmoothingQuality: ['low', 'medium', 'high'],
  fontKerning: ['auto', 'normal', 'none'],
  fontStretch: [
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'normal',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
  ],
  fontVariantCaps: [
    'normal',
    'small-caps',
    'all-small-caps',
    'petite-caps',
    'all-petite-caps',
    'unicase',
    'titling-caps',
  ],
  textRendering: [
    'auto',
    'optimizeSpeed',
    'optimizeLegibility',
    'geometricPrecision',
  ],
}
export const PIXEL_DRAWING_METHODS = new Set<PropertyKey>([
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clearRect',
  'fillText',
  'strokeText',
])

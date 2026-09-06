import { Window } from 'happy-dom'
import metadata from 'happy-dom/package.json' with { type: 'json' }

const window = new Window()
const apiNames = [
  'structuredClone',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'TextEncoder',
  'TextDecoder',
  'TextEncoderStream',
  'TextDecoderStream',
  'CompressionStream',
  'DecompressionStream',
  'CompositionEvent',
  'requestIdleCallback',
  'Worker',
]
let imageDataResult: unknown
try {
  imageDataResult = new window.ImageData(
    new window.Uint8ClampedArray([255, 0, 0, 255]),
    1,
    1,
  ).width
} catch (error) {
  imageDataResult = error instanceof Error ? error.message : String(error)
}
const composition = Reflect.construct(window.CompositionEvent, [
  'compositionend',
  { data: 'あ' },
])
let cryptoImportResult: unknown
try {
  // Older reports rejected buffers created in the window's VM during key import.
  const key = await window.crypto.subtle.importKey(
    'raw',
    new window.ArrayBuffer(16),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
  cryptoImportResult = { type: key.type, algorithm: key.algorithm.name }
} catch (error) {
  cryptoImportResult = error instanceof Error ? error.message : String(error)
}
const output = {
  node: process.version,
  happyDom: metadata.version,
  globals: Object.fromEntries(
    apiNames.map((name) => [name, typeof Reflect.get(window, name)]),
  ),
  binaryBlobText: await new window.Blob([
    new window.Uint8Array([65, 66]).buffer,
  ]).text(),
  bomBlobText: await new window.Blob(['\uFEFFA']).text(),
  blobBytes: typeof Reflect.get(window.Blob.prototype, 'bytes'),
  imageDataResult,
  xhrDone: Reflect.get(new window.XMLHttpRequest(), 'DONE') ?? null,
  compositionData: Reflect.get(composition, 'data') ?? null,
  cryptoImportResult,
}
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
await window.happyDOM.close()

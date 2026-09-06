# jest-happy-dom-extended

A Happy DOM Jest environment that supplies missing Node-backed Web APIs and repairs reproduced browser compatibility gaps.

## Usage

After the package is published, install it with Jest 30:

```sh
pnpm add -D jest jest-happy-dom-extended
```

```js
// jest.config.mjs
export default {
  testEnvironment: 'jest-happy-dom-extended',
  testEnvironmentOptions: { url: 'https://example.test/' },
}
```

Application-specific mocks and fixtures stay in your own `setupFiles` / `setupFilesAfterEnv`. The extensions are installed before those files run. Standard Happy DOM environment options continue to pass through to the upstream environment.

Installation completes synchronously in the environment constructor. `Blob.text()` uses the package's UTF-8 reader through the public `arrayBuffer()` API, including during setup. This intentional method replacement restores the original method after the last environment closes; it does not wait for an asynchronous capability probe.

Requires Node.js >=22.18.0 and Jest 30. The initial compatibility baseline is Happy DOM 20.14.0. ESM imports and CommonJS `require` share one CommonJS runtime and matching TypeScript declarations, so both loading styles coordinate the lifetime of shared Web API fixes.

## Included behavior

| API                                        | Extension                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `structuredClone`                          | Node's native clone algorithm, including cycles, standard data types, and ArrayBuffer transfer              |
| `TextEncoderStream`, `TextDecoderStream`   | Node's encoding streams                                                                                     |
| `CompressionStream`, `DecompressionStream` | Node's real compression streams                                                                             |
| `BroadcastChannel`                         | Native delivery with a namespace per test environment and teardown cleanup                                  |
| `MessageChannel`, `MessagePort`            | Entangled Node ports with matching constructor identity and cleanup of created ports                        |
| `Blob`, `File`                             | VM ArrayBuffer input normalization while preserving Happy DOM FileReader compatibility and Blob inheritance |
| `Blob.bytes()`                             | Fresh byte arrays, also available on Files and sliced Blobs                                                 |
| `Blob.text()`                              | UTF-8 decoding that consumes a leading BOM                                                                  |
| `ImageData`                                | VM pixel-array handling with preserved input identity, offsets, and shared storage                          |
| `Animation.cancel()`                       | Internally handles the rejected finished promise while allowing callers to observe its AbortError           |
| `XMLHttpRequest`                           | Instance-level `UNSENT`, `OPENED`, `HEADERS_RECEIVED`, `LOADING`, and `DONE` constants                      |
| `CompositionEvent`                         | Composed text via a read-only `data` property, retaining UIEvent flags and dispatch                         |

Sources and reproduction details live in the monorepo's research brief. Relevant upstream reports include [structuredClone #556](https://github.com/capricorn86/happy-dom/issues/556), [binary File #704](https://github.com/capricorn86/happy-dom/issues/704), [BroadcastChannel #1920](https://github.com/capricorn86/happy-dom/issues/1920), [XHR constants #2096](https://github.com/capricorn86/happy-dom/issues/2096), [Blob BOM #2355](https://github.com/capricorn86/happy-dom/issues/2355), and [CompositionEvent #1457](https://github.com/capricorn86/happy-dom/issues/1457).

## Opt-in Canvas helper

Importing the environment does not install a rendering stub. Tests that only need to observe the pixel handoff can request one explicitly:

```ts
import { installCanvasStub } from 'jest-happy-dom-extended/canvas'

test('hands pixels to the PNG encoder', () => {
  const stub = installCanvasStub({ dataURL: 'data:image/png;base64,AA==' })
  try {
    const canvas = document.createElement('canvas')
    const pixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)
    canvas.getContext('2d')?.putImageData(pixels, 0, 0)

    expect(stub.putImageDataCalls).toEqual([
      { canvas, imageData: pixels, dx: 0, dy: 0 },
    ])
    expect(canvas.toDataURL()).toBe('data:image/png;base64,AA==')
  } finally {
    stub.restore()
  }
})
```

The helper supports only `getContext('2d')`, `putImageData`, and a caller-specified `toDataURL` result. Other context types return `null`; this helper does not render pixels. Use one active helper per canvas prototype and always restore it. For actual rendering, use Happy DOM's [Node Canvas Adapter](https://github.com/capricorn86/happy-dom/tree/master/packages/@happy-dom/node-canvas-adapter).

## Runtime boundaries

- Node-backed APIs use Node's implementations and event/clone semantics. They do not make every Happy DOM object serializable by `structuredClone`; Happy DOM Blob, File, DOM nodes, and platform objects must not be treated as Node-native cloneable objects.
- Broadcast names are isolated per environment. Cross-window/origin browser broadcasting is not simulated. Consumers must close ports received from elsewhere or transferred out of the environment; teardown tracks the channels and ports created by the provided constructors.
- Jest 30.5.1 skips the environment teardown hook when `setupFiles` throws. A setup module that opens native channels must close them in its own `try/finally` if initialization fails. Native channel references are preserved so asynchronous setup cannot silently exit before running tests.
- Existing fetch, FormData, Blob, FileReader, and DOM event families are not replaced wholesale with Node equivalents.
- ImageData repair targets the reproduced array-realm problem; it is not a replacement canvas engine or a complete validation rewrite.
- Animation support repairs unhandled cancellation promises. Other upstream animation limitations remain, and actual motion should be checked in a browser.
- Real layout, Worker execution, idle scheduling, CORS simulation, WebGL, and text measurement are not added as empty stubs. Use a browser test or an appropriate explicit adapter for those behaviors.

## Local packaging

This package is initially developed in the `happy-dom-extended` monorepo. `pnpm build` produces `dist`; `pnpm check:package` validates export/type resolution; `pnpm test:package` installs an npm tarball into separate consumer fixtures for Jest 30.0.0 and the development version. Both setup phases and test execution are checked. The private compatibility package is bundled and is not needed by consumers.

MIT licensed.

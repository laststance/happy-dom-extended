# Canvas compatibility and verification

`jest-happy-dom-extended` owns the supported Canvas behavior around CPU `skia-canvas` 3.0.8. Happy DOM supplies DOM objects and the Jest environment; Skia supplies actual pixels and PNG/JPEG/WebP encoding. This is a selected Web API implementation, with the limits below, rather than a complete browser engine.

## Supported behavior

- HTMLCanvasElement and OffscreenCanvas 2D drawing, implicit paths, transforms, clipping, patterns, gradients, compositing, CSS filters, text, pixel read/write and actual encoded output.
- Dimension reflection and resets through IDL setters, content attributes, Attr aliases and attribute collections. Assigning the same dimension resets pixels, path, clip and drawing state while retaining context identity.
- ImageData constructor shape checks, Window errors and arrays, retained caller subarrays/shared storage, `createImageData`, `getImageData` and `putImageData`. Byte pixels support sRGB and display-p3 metadata with real relative-colorimetric conversion when crossing the sRGB renderer boundary.
- Owned image loading/readiness and intrinsic dimensions, Blob/ImageData/Canvas/video `createImageBitmap`, crop/resize/flip, real Bitmap storage, close, and Offscreen snapshot/reset.
- Real image/video subresource requests with CORS, redirect-origin tracking, request headers, cookies, cancellation and origin-clean propagation. A pending image does not paint later merely because a previous `drawImage` used it. Tainted sources cannot be read/exported or cloned/transferred as ImageBitmap; resizing resets that state.
- ImageBitmap cloning/transfer and context-free OffscreenCanvas transfer through the installed `structuredClone`, MessageChannel and dedicated Worker. Graph cycles, repeated references, Map/Set and native buffer transfer are preserved. Failed serialization does not detach otherwise valid senders. Closed ports discard messages without serializing or detaching them.
- HTML `transferControlToOffscreen` with actual placeholder pixels presented from the current rendering owner, including a real Worker. HTML width/height IDL setters are invalid after transfer; changing content attributes still updates reflection without clearing the placeholder bitmap.

Explicit custom Canvas adapters and explicit Worker/structuredClone implementations keep their existing ownership. The default implementation installs during environment construction, so setupFiles can use it before Jest calls environment.setup(). Jest teardown drains owned encodes and joins media/Worker cleanup without waiting for unrelated user intervals. Shared prototype patches restore after their last environment releases them.

## Renderer and runtime limits

The context's effective storage is sRGB `unorm8`. A requested P3 or float16 **context** reports the actual sRGB/byte settings. P3 **ImageData** is supported through real color conversion; it does not create a wide-gamut backing surface. Floating-point ImageData is unsupported and throws `NotSupportedError`; invalid pixel-format enums throw TypeError, and a byte array with the float16 format throws `InvalidStateError`.

Rasterization and installed system fonts can differ from a browser. The pinned Ahem comparison below measures those differences separately from API behavior. Opaque `alpha: false` contexts maintain opaque black backing as required by the specification; the local Chrome 152 headless comparison returned transparent initial pixels before a first draw, so that browser discrepancy is not copied. Skia's half-alpha compositing can differ by one channel level (127 versus 128).

Only the 2D context is implemented. WebGL, WebGPU, `bitmaprenderer`, a public Window.Path2D constructor, CanvasFilter objects, HDR/float surfaces and full browser text/layout behavior are not provided. The Canvas transfer extension handles ImageBitmap and OffscreenCanvas; it does not turn every Happy DOM class into a native structured-clone type. Browser-specific structured-clone realm behavior for ordinary Node values is not promised.

### Video

Video Canvas sources require **ffmpeg and ffprobe on PATH**. They decode real frames using CPU subprocesses; they are not needed for ordinary Canvas/image users. Missing executables or invalid media produce a recoverable media error. CI installs both executables on Ubuntu and Windows.

The selected frame is the most recent presentation timestamp at or before the requested time. Source replacement and newer seeks cancel/join older operations. Playback follows a monotonic clock and presents at most 20 frames per second; audio playback and browser media scheduling are outside the contract. Supported media formats depend on the installed FFmpeg build. The committed VP9 fixture has explicit color metadata, but YUV-to-RGB integer rounding differs by build: macOS produced red 254 and blue 255, while Linux/Windows CI produced red 253 and blue 254. Video checks allow at most two RGB byte levels from the original solid red/blue input and require exact alpha; frame selection, readiness and event assertions remain exact.

### Dedicated Workers

Window.Worker creates a real Node thread using the private packaged bootstrap. Supported entry sources are same-origin HTTP(S), owned Blob URLs and data URLs. Classic scripts support `importScripts`; module scripts support relative/absolute JavaScript URL imports, cycles, dynamic imports and top-level await using V8's module loader.

HTTP(S) classic entries, all imported classic scripts and all module scripts require JavaScript MIME types. Classic Blob/data entries retain the specification's non-HTTP MIME exemption. Module dependency fetches enforce CORS and the requested credentials mode. Entry redirects stay same-origin. Parent resource headers/interceptors/cookies are used for script loading; the worker's general fetch API belongs to its separate Happy DOM Window and is not a shared parent cookie store.

Local file URLs, Node/bare-package imports, import attributes, nested Worker, SharedWorker and ServiceWorker are outside this dedicated-worker contract. The worker global has no document/window/process/require bindings; the V8 context is not a security sandbox. Startup/runtime errors dispatch parent Window ErrorEvents. `terminate()` suppresses further delivery immediately; environment close waits for actual thread exit and force-terminates a blocked script after two seconds.

### Resource ceilings

| Resource                                                                                  | Bound / behavior                                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| One raster or ImageData allocation                                                        | 32,767 pixels per axis; 16,777,216 total pixels; excess allocation throws RangeError                        |
| Environment-owned rasters, snapshots, conversion buffers and media/transport reservations | 128 MiB; pending output remains accounted until completion                                                  |
| Media input                                                                               | 64 MiB per source                                                                                           |
| Decoder metadata/stderr                                                                   | 64 KiB                                                                                                      |
| FFmpeg operations                                                                         | 4 concurrent children per environment; 30-second operation timeout; one decoder thread; pipe-only protocols |
| Dedicated Workers                                                                         | 8 live children per Window; excess creation throws QuotaExceededError                                       |
| Unreceived Canvas messages                                                                | 64 per sending port plus the shared storage ceiling; excess throws QuotaExceededError before detachment     |
| Placeholder presentation                                                                  | One unacknowledged pixel frame; later draws coalesce                                                        |

Offscreen metadata reflection and context-free transfer do not allocate pixels: valid logical dimensions can exceed raster limits until an operation requires storage. Zero-size Canvas output remains `data:,`/null for HTML and IndexSizeError for Offscreen Blob conversion. These ceilings are implementation limits, not universal browser limits.

## Reproduce the rendering comparison

The committed `fixtures/canvas/render-cases.mjs` runs the same nine 16×16 drawings in the real browser and owned Canvas. `chrome-reference.json` was captured on macOS from HeadlessChrome 152.0.0.0 on 2026-09-08 JST. Base64 fields contain raw RGBA bytes, avoiding encoder differences. Ahem is the exact licensed WPT font recorded in `fixtures/canvas/Ahem.LICENSE.md`.

Run the comparison and independent codec checks:

```sh
node --test packages/compat/test/canvas-rendering.test.ts
```

To inspect or regenerate a browser reference, serve the checkout locally:

```sh
python3 -m http.server 57629 --bind 127.0.0.1
```

Open `http://127.0.0.1:57629/fixtures/canvas/browser.html` in Chrome. The page waits for Ahem and displays the complete reference JSON. With Playwright CLI, the same result is available using:

```sh
playwright-cli open http://127.0.0.1:57629/fixtures/canvas/browser.html
playwright-cli run-code 'async page => { await page.waitForFunction(() => document.querySelector("#result").textContent.startsWith("{")); return JSON.parse(await page.locator("#result").textContent()); }'
```

Review a new reference rather than updating it automatically to make a failing test pass. The tests compare alpha independently and premultiplied RGB so invisible color bytes do not inflate differences. RMS is over all 768 premultiplied RGB components.

| Case                         | Measured max alpha difference | Measured max premultiplied RGB difference | Measured RMS | Checked ceilings: alpha / RGB / RMS |
| ---------------------------- | ----------------------------: | ----------------------------------------: | -----------: | ----------------------------------- |
| Opaque rectangle             |                             0 |                                         0 |            0 | 0 / 0 / 0                           |
| Fractional rectangle         |                            48 |                                   35.5804 |       3.2207 | 48 / 36 / 3.3                       |
| Curved path                  |                            48 |                                   36.1647 |       4.3434 | 48 / 37 / 4.4                       |
| Blur                         |                            14 |                                   11.0863 |       1.9478 | 14 / 12 / 2                         |
| Brightness                   |                             0 |                                         0 |            0 | 0 / 0 / 0                           |
| Hue rotation                 |                             0 |                                         0 |            0 | 0 / 0 / 0                           |
| Drop shadow                  |                             1 |                                         1 |       0.1693 | 1 / 1 / 1                           |
| Display-p3 CSS red into sRGB |                             0 |                                         0 |            0 | 0 / 0 / 0                           |
| Ahem text                    |                            37 |                                   28.0039 |       4.8828 | 37 / 28.01 / 4.9                    |

The `AA` text width is exactly 20 in every case. Separate color tests match Chrome's sRGB red → P3 byte readback `[234, 51, 35, 255]` and P3 → sRGB red `[255, 0, 0, 255]`. PNG output is decoded with PNGJS and checked exactly. JPEG/WebP output is decoded with FFmpeg, with at most three color levels of error on the opaque solid-color sample and exact alpha. Codec signatures, dimensions and complete pixel lengths are checked. Existing output tests separately verify call-time snapshots, callback/errors, fallback MIME type and cleanup.

## Standards references and test scope

Behavior was reviewed against [WHATWG HTML source at 9ed7f27](https://github.com/whatwg/html/blob/9ed7f27762e6e34622bcca9ebc93cedd1c996e99/source), [WebIDL at 8f18262](https://github.com/whatwg/webidl/tree/8f182624f632a0ce485e236edbc1df18ca385b1d) and WPT revision `17d68806f7be968ed38196f068db03fb3a5dff2a`. The repository tests exercise selected equivalent behaviors; this is not a claim that the complete WPT suite was executed or passed.

| Reference case                                                                                                                                                                                                                                                                                                                                                                                                                                        | Repository coverage                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [canvas-host/2d.canvas.host.initial.reset.same.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/canvas-host/2d.canvas.host.initial.reset.same.html)                                                                                                                                                                                                                                  | Same-value dimension resets, pixels/state/clip and stable context                                                                |
| [canvas-host/2d.canvas.host.size.attributes.reflect.setcontent.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/canvas-host/2d.canvas.host.size.attributes.reflect.setcontent.html)                                                                                                                                                                                                  | Content attribute, Attr, namespace, removal and adoption routes                                                                  |
| [drawing-images-to-the-canvas/2d.drawImage.incomplete.immediate.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/drawing-images-to-the-canvas/2d.drawImage.incomplete.immediate.html), [2d.drawImage.broken.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/drawing-images-to-the-canvas/2d.drawImage.broken.html) | Call-time readiness and broken-source error                                                                                      |
| [pixel-manipulation/2d.imageData.object.ctor.array.bounds.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/pixel-manipulation/2d.imageData.object.ctor.array.bounds.html)                                                                                                                                                                                                            | Empty/incomplete byte views, width/height mismatch and source identity; not every wrong-typed-array overload in the old WPT case |
| [pixel-manipulation/2d.imageData.createImageBitmap.p3.rgba.unorm8.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/pixel-manipulation/2d.imageData.createImageBitmap.p3.rgba.unorm8.html)                                                                                                                                                                                            | P3 byte ImageData conversion into real Bitmap/sRGB pixels                                                                        |
| [filters/2d.filter.value.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/element/filters/2d.filter.value.html)                                                                                                                                                                                                                                                                              | CSS filter property and measured blur/color/drop-shadow output                                                                   |
| [offscreen/manual/the-offscreen-canvas/offscreencanvas.transferrable.html](https://github.com/web-platform-tests/wpt/blob/17d68806f7be968ed38196f068db03fb3a5dff2a/html/canvas/offscreen/manual/the-offscreen-canvas/offscreencanvas.transferrable.html)                                                                                                                                                                                              | Actual Worker transfer, received dimensions, context-bound rejection, detached sender and repeated-transfer rejection            |

Additional owned tests cover CORS on two real origins, video decode/seek/replacement, malformed input, resource ceilings, startup errors, live-child shutdown, native message listeners, receiver Window brands and partial-install restoration. Installed-tarball tests execute both supported Jest endpoints in serial and two-process modes, including the private Worker bootstrap from a path containing spaces. The GitHub test matrix is the authority for Linux/Windows and Node 22/24/26 results; a local macOS pass alone is not evidence that all six CI combinations passed.

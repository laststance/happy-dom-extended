# Owned Canvas semantics — Issue #4 implementation plan

Status: engineering review complete; 10 findings incorporated, no unresolved plan decisions. Implementation started from main 08273e7 after Issue #5 PR #8 merged. All Issue #4 work and all valid review findings belong to one PR; no TODO or follow-up deferrals. npm publication remains the user's manual action.

## Problem and evidence

The library currently subclasses the Happy DOM 20.14.0 node-canvas adapter, then wraps its instance methods. That adapter owns hidden bitmap/source behavior which the library cannot correct consistently. Preserve the working Jest lifecycle and move Canvas semantics into this repository.

Live comparison: Chrome 152 on macOS versus current source at 7b45f53, Happy DOM 20.14.0, node-canvas 3.2.3. Identical probes are saved in `.artifacts/canvas-probe.js` and `.artifacts/canvas-origin-probe.js`, with separate browser and Node JSON results. Renderer comparison uses the same 16×16 drawings and pinned Ahem font in Chrome, Cairo, and @napi-rs/canvas 1.0.8.

| Area              | Confirmed observation                                                                                                                                                                                           | Required outcome                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dimensions        | Attr.value leaves old pixels/state; Attr.nodeValue/textContent do not change the value. NamedNodeMap set/remove and namespaced non-dimension attributes already behave correctly.                               | Every dimension route shares one synchronous reset path, including equal values, before/after first context creation.                                                                |
| Conversion/errors | HTML negative/NaN/wrapping widths and Offscreen constructor values differ; invalid drawImage/createPattern inputs can silently pass; zero getImageData and detached ImageData throw the wrong exception family. | WebIDL conversion, overload validation, correct Window errors and no native calls for invalid input.                                                                                 |
| Source readiness  | A draw made while an image is loading paints later after load. ImageData/Blob createImageBitmap are rejected.                                                                                                   | Read source state at invocation; real owned image/bitmap/video pixels, intrinsic dimensions, explicit failure paths.                                                                 |
| Origin clean      | Non-CORS cross-origin images fail loading upstream instead of loading and tainting. Redirected images have the same problem. CORS rejection does not cause drawImage's required InvalidStateError.              | Correct subresource CORS/loading and taint propagation through images, patterns, canvases, bitmaps and exports.                                                                      |
| Rendering         | Cairo ignores CSS filter effects and display-p3 color syntax. Skia implements blur/brightness/hue rotation, but also has measured rasterization differences and maps native width=0 to 350.                     | Use Skia's real rendering/PNG/JPEG/WebP codecs; own DOM dimensions and color conversion; document measured edge/font tolerances rather than promise identical browser rasterization. |
| Transfer          | ImageBitmap and OffscreenCanvas structured transfers fail; Window.Worker is absent. Existing transferToImageBitmap snapshot/reset worked in the probe.                                                          | Preserve that snapshot behavior; implement cloning/transfer ownership and actual worker execution, detachment, errors and cleanup.                                                   |

Pinned reference revisions: WHATWG HTML `9ed7f27762e6e34622bcca9ebc93cedd1c996e99`, WebIDL `8f182624f632a0ce485e236edbc1df18ca385b1d`, WPT `17d68806f7be968ed38196f068db03fb3a5dff2a`. Use applicable WPT cases from canvas-host, drawing-images-to-the-canvas, pixel-manipulation, filters, and ImageBitmap/Offscreen transfer tests; record exact test paths in the committed verification document.

## What already exists

- `canvas/adapter.ts`: invocation snapshots, Happy DOM task registration, own-output drain, idempotent disposal, weak Canvas ownership and error aggregation. Reuse these mechanisms.
- `canvas/context.ts`: stable bound methods, DOM owner identity, consumer spies and restoration. Retain the observable behavior while removing reliance on upstream method monkeypatches.
- `canvas/dimensions.ts`: existing attribute callbacks and same-value resets. Consolidate them with Attr and pre-context dimension handling.
- `utils/replace-property.ts`: shared prototype reference counting and teardown rollback. Reuse for per-Window API installation.
- Binary compatibility: Blob/File bytes, ImageData VM identity and shared subviews. Reuse; do not replace with native constructor aliases that break those contracts.
- Node regressions, actual Jest VM, fast-check properties, independent pngjs decoding, installed tarballs, ESM/CJS shared lifetimes and two-worker consumer proof. Extend these gates.

## Implementation evidence and renderer selection update

The initial @napi-rs/canvas 1.0.8 integration exposed additional concrete regressions: aligned two-pixel patterns blurred alpha into adjacent pixels (39/216 instead of 0/255), image decoding was not reliably synchronous at an existing Happy DOM load boundary, native zero became 350×150, and resizing retained stale style metadata. An isolated comparison with `skia-canvas` 3.0.8 (`042312a3f40b660b1d7dc0beba541486171bc5cc`) passed exact aligned pattern pixels, synchronous buffer image decoding, stable context/reset style and true zero-sized release. The implementation therefore uses this Skia binding in CPU mode. This replaces the tentative renderer choice; it does not defer any implementation task or review finding.

Both candidate bindings have sRGB backing storage. The context reports effective `colorSpace: 'srgb'` even when P3 is requested; Culori converts CSS Color 4 input into that gamut. A P3 request must never be reported as P3 storage without corresponding pixel evidence. ImageData now performs tested sRGB/display-p3 byte conversion at the renderer boundary. PNG/JPEG/WebP encoders are bundled by the selected renderer, so the old unavailable-Cairo-JPEG fallback test now verifies independence from foreign adapter codec configuration; native encoding failures still exercise null/rejection, task completion and raster release.

The selected renderer's repeatable 16×16 comparison records exact opaque/brightness/hue-rotate pixels, drop-shadow max alpha/premultiplied difference 1, blur max alpha 14 and premultiplied 11.09, fractional edges max alpha 48 and premultiplied 35.59, curved edges max alpha 48 and premultiplied 36.17. Ahem text width is 20 with max alpha difference 37. These measurements do not imply full browser equivalence; the common browser/Node fixture, pinned font, raw reference pixels and exact WPT paths are committed in fixtures/canvas and docs/canvas-compatibility.md.

The pinned Canvas settings specification requires alpha:false backing to remain opaque. The available Chrome 152 headless build returned transparent initial readback before a first draw and retained putImageData's alpha, contrary to that invariant. The implementation tests the normative opaque behavior, records this browser discrepancy, and preserves unmodified input bytes. Its half-alpha Skia composite differs from Chrome by one color level (127 versus 128). The temporary `flattenOpaque` implementation is explicitly marked O(pixel count); native opaque storage is preferable when the renderer supplies it.

Current milestone: T1–T7 are complete. [PR #10](https://github.com/laststance/happy-dom-extended/pull/10) merged at `c40d766fe265d7c1070c9e3a9721b7b7b54c3f84` after all 21 checks passed, the full CodeRabbit review covered `d86b89644ce93dfe7b9b8ad9713730c46088e95f`, and all 41 review threads were resolved with verified fixes or documented dispositions. The final implementation gate passed 166 Node tests, 20 Jest tests and both installed Jest consumers with 11 lifecycle tests and 10 Jest tests in serial/two-process modes each. OCR coverage reached all 65 reviewable files; the six specialists, Red Team and fresh-context Codex adversarial review are recorded below without claiming a separate model family. T7 adds npm-first root/package guides, version 0.2.0 and its changelog, explicit public registry/access, and the manual tarball inspection/release procedure after that merge. Both npm 12 and pnpm 12 run the documented Canvas example in isolated consumers; the package-verification script also explicitly permits Skia installation under npm 12. Publication remains a manual maintainer action.

Video verification uses the committed `fixtures/consumer/red-blue.webm` and adjacent source/license record. A real two-origin server verifies no-CORS taint, denied CORS, accepted CORS and stale-source replacement. Window-close tests settle never-resolving request interceptors; missing FFmpeg produces an actionable media error while ordinary Canvas remains usable. Playback completion follows actual decoded frames and the monotonic clock. FFmpeg/ffprobe execute with pipe-only inputs, one thread, a 30-second operation deadline, 64-KiB metadata cap, at most four concurrent children per Window, and frame/source storage within the adapter budget. Each video serializes decodes and joins cancellation before releasing owned memory. Presentation samples at most 20 fps; no browser-rate or audio playback claim is made. CI explicitly installs/verifies FFmpeg on Ubuntu and Windows.

The owned implementation was also driven through Playwright CLI and recorded in `.artifacts/video-owned-play-seek.webm`; extracted frames 03/07 show actual red/blue playback pixels, frame 09 shows the return to 0.1 s/red, and frame 15 shows 1.1 s/blue after seeking. The served preview displays PNG output from the repository's real Node Canvas and FFmpeg pipeline. `.artifacts/video-owned-record-result.txt` records `[254, 0, 0, 255]` at 0.1 s and `[0, 0, 255, 255]` at 1.1 s. This complements the earlier native-browser comparison; it is not evidence of unimplemented worker or transport behavior.

## Architecture and API contract

### One Canvas state, one renderer

Implement the existing Happy DOM adapter interface directly. Replace the published dependency on the upstream adapter and node-canvas with pinned Skia; retain the old adapter/node-canvas only as development dependencies for explicit foreign-adapter compatibility tests.

State owns logical width/height, context mode, native bitmap, origin-clean status, transfer/detach status and instance restorers. A WeakMap indexes owners; lifecycle tracking keeps WeakRefs only. HTML/Offscreen owners retain stable contexts. Native allocation happens lazily and has an explicit tested allocation ceiling. A logical zero bitmap uses the selected renderer's real zero-size surface, suppress drawing into logical zero, and preserve HTML null/data:, versus Offscreen IndexSizeError exports. Release native storage to a zero-size surface on reset/disposal and drop ownership references; no GC-based pass criteria.

```text
Window installation ── shared prototype restorers ── last-owner restoration
         |
HTML / Offscreen / ImageBitmap
         | validated input, owner lookup
         v
Canvas state [logical dimensions | context mode | origin clean | detach state]
         |                           |
         v                           v
Skia pixels                    owned source metadata
         |
         +── synchronous readback / data URL
         +── call-time snapshot → encode → callback/promise → release
                                      |                    |
                                      +── Happy DOM task ──+
                                      +── adapter drain ───+
```

### Dimensions and WebIDL

- Install Canvas bindings during compatibility setup, before setupFiles can create an element/context. Preserve explicit custom adapters and disabled Canvas settings.
- HTML width/height reflection handles missing/invalid content attributes and limited unsigned-long IDL conversion. Patch Attr.value/nodeValue/textContent for owned Canvas attributes and use the same reset callback as setAttribute/NamedNodeMap; unrelated attributes/namespaces and other Windows remain unaffected.
- Offscreen constructor/setters use EnforceRange unsigned-long conversion; validate detached and placeholder states. Keep metadata meaningful without forcing a bitmap allocation.
- Prefer a small maintained WebIDL conversion dependency over handwritten JavaScript coercion. Preserve user-thrown coercion errors and evaluation order; use the caller Window's TypeError/DOMException for platform validation.
- Validate supported 2D method overloads, minimum arguments, finite numbers, enum values, image-data shape/detachment and image source brands. Include negative source/destination sizes and zero rectangles. Native renderer exceptions must not leak as host errors for standard error cases.

### Real sources and origin clean

- Own image request/decode metadata: source generation, decoded pixels, intrinsic dimensions, readiness, original/final URL, request CORS mode and origin-clean flag. Failed/stale/cancelled loads cannot overwrite newer state.
- Readiness is sampled at draw/createPattern invocation. Incomplete images do not register a future drawing callback; broken images throw the required error. HTML image CSS dimensions do not replace intrinsic dimensions.
- Implement createImageBitmap from Canvas, OffscreenCanvas, ImageBitmap, ImageData and Blob, including crop, resize, orientation, invalid sizes, close and lifetime. Copy at the specified invocation boundary and free owned copies.
- Include real video-frame loading and seeking for Canvas input using FFmpeg/ffprobe subprocesses, with explicit executable prerequisites and tests using a generated two-color VP9 fixture. Read actual decoded dimensions/pixels; no fabricated readyState or blank frame. Missing decoder, bad media, cancellation and stale seeks surface recoverable media errors. Keep decoding isolated from ordinary image/Canvas users, bound input/output, pass argument arrays without shell execution and disable decoder network protocols. Do not turn this into an audio/browser media-player project.
- Implement correct image/video subresource fetching without disabling the parent Window's same-origin policy. Record redirect origin changes, CORS allow-origin/credentials, data/blob origin inheritance, and abort controllers. Preserve explicit resource-loading options and cookies where applicable. Test actual two-origin HTTP responses, redirects and denied CORS.
- Taint follows successful source use and pattern use into the target; clean drawing/clearRect cannot untaint; dimension reset can. Block getImageData, data URL, Blob exports, bitmap cloning/transfers as specified. Never classify decoder success as same-origin evidence.

### Rendering and encoding

- Skia supplies paths, filters, compositing and codecs. Bridge Window ImageData arrays without losing identity/offset/shared storage. Expose effective context settings and validate requested enum values.
- Add standards-based CSS color conversion where native parsing is missing (including display-p3 input), applying it consistently to styles, gradient stops and shadows. Prefer a maintained color conversion library over a new matrix/parser implementation.
- Preserve save/restore, reset, clipping/path reset, alpha:false and consumer method spies/restoration. Test both direct API use and foreign adapter sources using real pixel copies.
- PNG exact opaque pixels; JPEG/WebP independently decoded with appropriate lossy tolerance. Unsupported MIME types use a real PNG with matching type. Quality conversion and encoder failure paths remain covered.
- Renderer evidence includes opaque/fractional rectangles, curves, blur, color filters, drop-shadow, color-space inputs and pinned Ahem font. Compare premultiplied color/alpha at edges, measure font metrics separately, and document actual platform/backend differences. No claim of complete browser raster equivalence.

### Cloning, transfer and workers

- Own ImageBitmap storage and close/detach state. Offscreen transfer requires the permitted context mode; HTML transfer establishes one placeholder owner and rejects repeated/context-bound transfer.
- Use native structuredClone for ordinary values and native ArrayBuffer transfers. Wrap only owned Canvas/ImageBitmap payloads. Preserve graph cycles, aliasing, arrays, Map/Set, typed views and native transferables; avoid property-name marker collisions by storing special placeholder identities in an outer envelope.
- Validate the entire transfer list before mutation: duplicate, missing, closed, tainted or ineligible entries fail atomically; serialization/getter errors must not detach any Canvas owner. Commit detachment only after the native clone/transfer succeeds.
- Apply the same transport to MessageChannel and dedicated Window.Worker. Workers execute in real node:worker_threads with internal package bootstrap code, browser-facing message/error APIs and Canvas bindings; no in-process pretend worker. Test transfer there and back, errors, termination and close during in-flight output.
- Ship the internal worker bootstrap in dist without a new public setup import or public loading helper. Support defined classic/module script sources and document resolution rules; do not silently reinterpret arbitrary URLs as local file access. Integrate startup/output tasks and environment-owned termination. Restore shared transport/prototype patches independently across simultaneous environments.

## Test and failure map

```text
installation
  ├─ default / custom / disabled adapter → existing constructor/setup fixtures
  └─ partial patch failure → rollback + second environment survives
dimensions
  ├─ IDL / attributes / Attr aliases / NamedNodeMap / same value → metadata + pixels + state
  ├─ invalid conversion / too-large allocation → correct error, no native allocation
  └─ zero / placeholder / detached → correct output/context restrictions
context methods
  ├─ valid overload → real pixels, owner and Window image family
  ├─ wrong brand / missing args / nonfinite / zero / detached → Window error or specified no-op
  └─ consumer spy / descriptor restoration → still real rendering
media source [integration: real HTTP + decoder]
  ├─ loading / ready / broken / reload / seek → invocation-time pixels only
  ├─ same / cross / CORS / credentials / redirect → origin-clean metadata
  └─ abort / stale completion / bad codec / missing FFmpeg → error + released resources
origin clean
  ├─ direct source / source Canvas / ImageBitmap / pattern → propagates taint
  ├─ readback / output / clone blocked → correct Window exception
  └─ clear vs dimension reset → taint retained vs restored
encoding
  ├─ redraw/resize after request → independent decoded original image
  ├─ unsupported MIME / quality / native failure → matching bytes/type/error
  └─ callbacks throw / registration fails / Window closes → drain + complete cleanup
transfer [integration: actual worker_threads + installed package]
  ├─ graph/cycles/aliasing/native buffers → correct received identity and bytes
  ├─ clone / successful transfer → copied vs detached sender; received real pixels
  ├─ duplicate/closed/tainted/context-bound/serialization failure → atomic no-detach
  └─ worker throws/exits/terminates/teardown → visible error, no live worker/native output
distribution
  └─ tarball setupFiles + ESM/CJS + serial/2 workers + Node 22/24/26 Linux/Windows
```

Every branch above gets an observable test; keep the existing error-injection/cleanup and 450-case property suites. Browser comparisons use the recorded/pinned standards/WPT sources, independently decoded outputs and explicit tolerances. Video/worker integration must use actual codecs/processes. Record video for playback/seek motion verification and inspect extracted frames. Do not mark a zero-test command as validation.

## Implementation tasks and order

- [x] T1: Consolidate Canvas state and implement the adapter directly on Skia; preserve snapshots, drain and disposal. Update old native fault-injection targets to the new renderer without dropping error-path assertions.
- [x] T2: Add installation-time dimension/Attr bindings and WebIDL/2D input conversion, with all mutation and error regressions.
- [x] T3: Implement owned image/bitmap/video sources, request cancellation and origin-clean propagation; verify two-origin fixtures and real video frames.
- [x] T4: Implement clone/transfer graph handling, MessageChannel transport and actual Worker bootstrap/lifecycle; extend installed-tarball worker tests.
- [x] T5: Complete rendering/color/codec behavior and measured browser comparison records; preserve real Window ImageData and foreign-adapter interoperability.
- [x] T6: Run all local gates, both requested implementation reviews, resolve every valid finding in this PR, and use apollousa through CodeRabbit, six-environment CI, merge and cleanup.
- [x] T7: After that merge, update root/package READMEs to npm-first usage and actual support/prerequisites. Inspect publish files/exports/settings and prepare the manual npm release without publishing.

Expected modules: `packages/compat/src/canvas/`, compatibility installation/messaging, Jest environment packaging, Canvas regression/property tests, consumer fixtures, verification/research docs, dependency manifests/lockfile and existing test CI. Shared state/ownership makes core implementation sequential. Tests and documentation may be reviewed independently after the contract is settled; never split the changes into separate feature PRs.

## NOT in scope

- npm publication: explicitly reserved for the user after artifact review.
- A Vitest runner, browser layout, WebGL/WebGPU, audio playback or a general browser implementation: unrelated to the selected Canvas/transfer contract. No Issue #4 finding is deferred to another PR.

## Review checkpoint

The engineering review must challenge dependency/prerequisite cost, image fetch/cookie/CORS correctness, video decoding scope, native empty allocation, alias-safe atomic transfer, worker packaging/shutdown and preservation of existing lifecycle/fault regressions. Resolve those decisions in this plan before implementation. Record the four-section review, failure coverage, and final review report here.

## Engineering review — scope and architecture

Target: this Issue #4 plan, not the unrelated Issue #5 branch diff. Full scope retained under the user's standing instruction to implement every valid finding in one PR. This review applies that authorization to routine implementation decisions; it does not claim that new approval questions were answered. The work exceeds eight files because the requested behavior spans Canvas, sources, transport, packaging and their regression tests. Shared ownership keeps the core work sequential. No feature or finding is moved into a TODO or another PR.

Existing design input is the live Issue #4, repository research and the executed browser comparisons above. No separate design document or TODOS.md exists. Project-scoped gstack learning `jest-setupfiles-before-environment-setup` (confidence 10/10, 2026-09-06) confirms installation must happen in the environment constructor. No unavailable brain-cache content is assumed. Aside is unavailable; official specification, runtime and library documentation were used.

1. **[P1] (confidence: 9/10) Draft line 71 — request policy is underspecified.** The draft says, “Preserve explicit resource-loading options and cookies where applicable.” Happy DOM's `Fetch.ts:114-115` also captures an interceptor and configured request headers, while `BrowserContext.ts:19` owns cookies. Replacing only `window.fetch` with host fetch would bypass these observable policies. **1A [Layer 2], selected:** one owned media loader adapts the existing browser settings, cookie container, interceptor and virtual-server behavior; it follows each redirect with explicit credential/origin decisions and registers cancellation with the originating frame. **1B:** an isolated loader that silently ignores consumer policy is rejected. Document/test any deliberately unsupported interception shape as an error rather than silently requesting the network. Never mutate the parent Window's global same-origin setting. Decode only bytes returned by that loader; SVG and video decoders must not initiate secondary network or local-file access.

2. **[P1] (confidence: 9/10) Draft lines 85-86 — native transfer validation can be accidentally duplicated.** The draft requires both graph preservation and “serialization/getter errors must not detach any Canvas owner,” but does not define the number of reads. **2A [Layer 1], selected:** walk supported graph nodes once, preserving aliases in a WeakMap; evaluate enumerable getters once, then pass the prepared envelope and the original native transferables to one native serialization/transfer operation. Detach owned Canvas/ImageBitmap/port senders only after that operation succeeds. Never clone native ArrayBuffers in a preflight pass. Preserve sparse arrays, cycles, Map keys, Set members, shared views and native error behavior. The receiver reconstructs special objects by identity records, not a user-visible magic property. **2B:** serialize twice or detach during traversal is rejected. Add failure tests with a throwing getter, duplicate transfer entry and a native untransferable buffer in the same payload as a valid bitmap.

3. **[P1] (confidence: 9/10) Draft line 88 — worker distribution and startup shutdown need an exact contract.** Existing `packages/jest-happy-dom-extended/tsdown.config.ts:4` builds only `src/index.ts`. **3A [Layer 1], selected:** build an internal CJS worker bootstrap into the same published dist directory and resolve it from the canonical package module, including installed paths with spaces. Use real worker_threads and a separate worker global; support classic and module scripts with explicit URL/import rules, same-origin/CORS checks and inherited resource policy. Worker startup failure dispatches an error; termination cancels fetch/decode, closes ports and settles pending tasks. Parent teardown awaits owned worker termination before final adapter disposal. HTML placeholder updates use real worker bitmap snapshots and scheduled presentation; do not leave a disconnected placeholder after transfer. **3B:** source-checkout-only paths or a synchronous in-process Worker substitute is rejected. Workers and decoder processes are execution facilities for trusted test code, not a security sandbox. No arbitrary remote URL is treated as a local module path.

Architecture review: 3 issues, all resolved into implementation requirements. Ordinary Canvas work does not invoke FFmpeg; only actual video decoding requires `ffmpeg` and `ffprobe` on PATH. Keep those explicit prerequisites rather than adding a binary-downloading install script. CI must install/verify the prerequisites on both supported operating systems and exercise them in installed-consumer tests.

## Engineering review — code quality

4. **[P1] (confidence: 9/10) Draft lines 59-60 — shared prototype patches need receiver-based ownership.** The draft requires “unrelated attributes/namespaces and other Windows remain unaffected,” while `utils/replace-property.ts` retains the first patch until its last owner restores it. **4A [Layer 1], selected:** shared hooks route through the actual receiver's owner document/Canvas state; they must not close over the first Window or adapter. Reuse the existing reference-counted restorer, register restoration immediately after each mutation, and leave custom/disabled Canvas adapters on their existing paths. **4B:** new per-Window global-prototype closures and duplicate restoration registries are rejected. Verify two simultaneous environments, closing either first, an unmodified third Window, detached Attr nodes and adoption between documents. Consumer method spies and unbound native method stability remain regression contracts.

5. **[P2] (confidence: 9/10) Draft lines 62 and 77 — unspecified conversion implementations invite parallel parsers.** The draft says “Prefer a small maintained WebIDL conversion dependency” and “Prefer a maintained color conversion library.” **5A [Layer 3], selected:** use jsdom's `webidl-conversions` for scalar conversion with the caller Window's Number/String/TypeError globals, and Culori's CSS parsers/converters for unsupported CSS Color 4 syntax. Resolve and pin compatible versions after the manifest update; do not introduce generated bindings, a homegrown color parser, or a second generic validation framework. Preserve conversion evaluation order, user-thrown errors, rejected style assignments and context settings across save/restore/reset. Apply the same color conversion to fill, stroke, shadow and gradient stops; preserve unsupported-input no-op versus exception rules. **5B:** separate parsers inside each Canvas method are rejected. Effective sRGB/P3 context output must be measured against the requested color space; converting P3 input to clipped sRGB alone does not prove P3 readback support.

Code quality review: 2 issues, all resolved into the same PR. Reuse disposal, mutation restoration, binary bridging, native transport and native encoding; introduce only modules that own distinct state/resources. Update inline ownership diagrams when the actual lifecycle changes. Comments document why an ownership boundary exists; tests keep explicit observable expectations.

## Engineering review — tests

Detected framework: Node's built-in test runner for compatibility/lifecycle checks, Jest for the actual VM, fast-check for generated inputs, and real installed tarballs for distribution. Existing `pnpm check` invokes all of them. There is no UI/LLM product or eval suite in this change.

6. **[P1] (confidence: 9/10) Draft line 80 — renderer measurements need reproducible artifacts.** The draft lists “pinned Ahem font” and differences, but not fixture licensing or repeatable comparison commands. **6A, selected:** commit the small comparison cases, expected opaque pixels and measured alpha/premultiplied tolerances; pin exact WPT case paths and font source/license. Use PNGJS for PNG and an independent browser/FFmpeg decoder for JPEG/WebP. Check color/alpha settings and codec signatures, not only MIME prefixes. Cover both CI operating systems; classify font/raster observations separately from API pass/fail. **6B:** unrepeatable screenshots or decoding only with the producing renderer are rejected.

Additional executed evidence: a generated 16×16, two-second red/blue VP9 WebM with explicit SMPTE 170M limited-range metadata produces `[254, 0, 0, 255]` at 0.1 s and `[0, 0, 255, 255]` at 1.1 s in both Chrome and FFmpeg. The untagged file differed by up to 24 green-channel levels because the decoders chose different defaults. FFmpeg output seeking alone selected the following frame or no frame; select the most recent presentation timestamp at/before the requested time and retain only the last complete frame while streaming decoder output. The browser playback was recorded in `.artifacts/canvas-video-tagged.webm`; extracted frames 03 and 07 were inspected and showed real red-to-blue video/Canvas updates. Ahem's embedded font license declares public-domain ownership with a CC0 fallback; preserve its license/source in the committed fixture record.

7. **[P1] (confidence: 10/10) Draft task T1 — replacing the native backend changes every failure injection target.** The draft says “Update old native fault-injection targets ... without dropping error-path assertions”; `canvas.test.ts` currently imports Cairo Canvas/context classes for those injections. **7A, selected:** migrate each existing encode/allocation/callback/task-registration/restoration failure test to the corresponding Skia boundary, retain its observable cleanup assertion, and add explicit native empty-surface accounting. Keep the generated snapshot/resize tests and real shared-buffer Jest ImageData tests intact. **7B:** deleting tests that mention the old renderer is rejected. This is critical regression coverage, not optional new scope.

8. **[P1] (confidence: 9/10) Draft lines 87-88 — happy-path worker/decoder tests miss close races.** **8A, selected:** installed-package tests cover constructor/setupFiles visibility, startup fetch failure, module import failure, worker exception, termination during load/encode, invalid transfer mixed with a valid native buffer, reordered media loads and seeks, and parent teardown with a live child. Assert real worker identity differs from the parent, actual returned pixel values, sender detachment and no owned live resources. Real two-origin servers assert cookie/header forwarding, redirects, CORS failure and stale-request cancellation. Record the browser video seek interaction and inspect extracted frames when validating motion. **8B:** a mocked worker or a process that exits without executing assertions is rejected.

Coverage requirements below are planned, not a claim of already executed new tests. Existing regressions cover the marked baseline rows; every NEW row must ship observable edge/error coverage in this PR.

```text
FLOW / BRANCH                                         REQUIRED OBSERVATION
constructor -> install -> setupFiles [baseline, E2E]   APIs usable before environment.setup()
  -> custom/null/false adapter [baseline]               override identity preserved
  -> second environment -> close either [NEW]          survivor draws/messages; last owner restores
  -> failed partial install [baseline + NEW]            all prior patches/resources released
dimension input -> WebIDL / Attr / NamedNodeMap [NEW]   width + pixels + drawing state, stable context
  -> same value / removal / namespace / adoption       correct reset or unaffected state
  -> zero / huge / detached / placeholder [NEW]        documented errors, bounded allocation
source URL -> loader -> response -> decoder [NEW,E2E]  actual intrinsic size and pixels
  -> denied / failed / stale / aborted / invalid       correct readiness/error, no delayed paint
  -> redirect / cookies / headers / interceptor        origin and explicit user policy retained
  -> video load -> seek -> newer seek [NEW,E2E]         selected real frame wins, old process cancelled
source -> draw/pattern/bitmap -> destination [NEW]      correct crop, transform, lifetime, taint
  -> no pixels / broken / closed / wrong brand         Window error or specified no-op
  -> read/export/clone tainted -> reset [NEW]           denied before reset; clean afterward
context -> native Skia [baseline + NEW]                real paths/styles/filters/context settings
  -> ImageData ordinary/shared VM views [baseline]    array identity, byte offset and mutation survive
  -> consumer spy / foreign adapter [baseline]         stable methods and actual source pixels
export -> snapshot -> native encode [baseline]         call-time image despite redraw/resize
  -> task-start / encode / callback / cleanup failure  every temporary bitmap/task released
graph -> prepare once -> native transfer [NEW,E2E]     cycles, aliases, getters once, exact payload
  -> failure anywhere before commit                   no owned/native sender detached
  -> worker/port -> receiver -> response [NEW,E2E]     actual child execution, matching received brands
  -> HTML placeholder presentation [NEW,E2E]          parent displays worker's actual latest pixels
  -> terminate / throw / parent closes [NEW,E2E]       visible failure and joined child shutdown
pack -> isolated install -> mixed ESM/CJS [baseline]  canonical module and complete worker dist
  -> serial + two Jest processes [baseline + NEW]      executed test counts and distinct worker reports
  -> six OS/Node combinations [baseline + NEW]         same assertions, native codecs and FFmpeg present
```

Failure handling must accompany each NEW failure branch: observable DOMException/TypeError, rejected export, error/media event or recoverable termination. No silent failure branch may be left without both handling and a runnable test. There are no LLM evals. Test review: 3 gaps resolved into required tests; no deferred tests.

## Engineering review — performance

9. **[P1] (confidence: 10/10) Draft line 37 — native dimensions and allocation limits are not interchangeable.** The measured Skia probe maps a native zero width to 350, so applying the old `bitmap.width = 0` release would retain unexpected pixels/storage. The draft only promises an “explicit tested allocation ceiling.” **9A, selected:** retain logical zero dimensions without allocating an image; release allocated images to the selected binding’s verified zero-size surface and drop the owner reference (the implementation update above supersedes the initial 1×1 fallback). Before allocation, validate both axis limits and multiplication overflow; initially cap a raster at 16,777,216 pixels / 32,767 pixels per axis and total active native raster/snapshot bytes at 128 MiB per environment. Exceeding an implementation allocation ceiling must produce the documented failure, never an unbounded native allocation. Count asynchronous snapshots until their encoders finish; a refused HTML export still calls back asynchronously with null and Offscreen rejects EncodingError. Zero-size/metadata-only reflection remains independent of native allocation. **9B:** relying on V8 heap limits or FinalizationRegistry to release native memory is rejected. Limits are explicit implementation limits, not asserted universal browser limits.

10. **[P1] (confidence: 9/10) Draft line 70 — media bounds need concrete cancellation and scheduling.** The draft says “bound input/output,” but concurrent seeks and requests can multiply full-file buffers and decoder processes. **10A [Layer 1], selected:** one current request and one current decode per source, with a generation token plus AbortController. Cancel the old process on a newer seek/src and join it on disposal. Reuse the source bytes for seeking, release them on source replacement/close, and decode only the requested frame. Cap input at 64 MiB, decoded dimensions by the raster limit, probe output at 64 KiB and each decoder operation at 30 seconds; subprocess protocol whitelist allows only supplied pipe data, no external network/files. Use bounded asynchronous child processes with argument arrays and a kill-and-join failure path. Cap environment-owned workers at eight; startup, termination and native snapshot limits are observable and tested. **10B:** repeated full downloads or an unbounded worker/decoder queue is rejected. No database or cache layer is needed. Pixel transfer uses owned ArrayBuffers, not pooled Buffer storage; graph work is linear in visited nodes/pixels.

Performance review: 2 issues resolved into implementation and boundary tests. Existing source/bitmap ownership is reused rather than adding a global cache. Implementation must verify the limits against actual native allocation paths, including temporary conversion surfaces and pattern/bitmap copies, before the documented contract is considered complete.

## Review-derived implementation tasks

These are tasks within the same PR, not a deferred backlog. Effort ranges are planning estimates for implementation plus verification; CI/review wait time is additional.

- [x] **R1 (P1, human: ~2 days / Codex: ~2 hours)** — sources — preserve browser request policy, redirects, CORS, cancellation and decoder isolation.
  - Surfaced by: Architecture finding 1 and Performance finding 10.
  - Files: `packages/compat/src/canvas/`, source tests, HTTP/video fixtures, test CI.
  - Verify: actual two-origin/cookie/interceptor/reload/seek/error tests; process resource cleanup.
- [x] **R2 (P1, human: ~2 days / Codex: ~2 hours)** — transfer — implement one-pass atomic transport, owned worker bootstrap and joined shutdown.
  - Surfaced by: Architecture findings 2-3 and Test finding 8.
  - Files: compatibility messaging/Canvas, Jest build, worker fixtures, installed consumer tests.
  - Verify: native buffers + owned bitmaps fail atomically; actual worker round trip, placeholder pixels, teardown and tarball paths.
- [x] **R3 (P1, human: ~1 day / Codex: ~1 hour)** — Canvas state — route shared hooks by receiver, preserve constructor-time installation and old failure guarantees.
  - Surfaced by: Code Quality finding 4 and Test finding 7.
  - Files: Canvas state/dimension bindings, compatibility installation, regression/property suites.
  - Verify: every dimension route plus simultaneous Windows, spies, rollback, own-output drain and disposal failures.
- [x] **R4 (P2, human: ~1 day / Codex: ~1 hour)** — standards and rendering — reuse conversion libraries, pin comparison evidence and verify color/codec output independently.
  - Surfaced by: Code Quality finding 5 and Test finding 6.
  - Files: Canvas argument/style bindings, manifests/lockfile, comparison fixtures and research docs.
  - Verify: Window exceptions, scalar coercion order, CSS Color 4, color-space settings, PNG/JPEG/WebP bytes and licensed font fixtures.
- [x] **R5 (P1, human: ~1 day / Codex: ~1 hour)** — resource ownership — enforce raster/snapshot/media/worker bounds without changing logical dimension reflection.
  - Surfaced by: Performance findings 9-10.
  - Files: Canvas state/output/source ownership and their lifecycle tests.
  - Verify: rejected allocations do not call native allocation; snapshots/processes are counted until completion; repeated failure/teardown releases ownership.

Sequential implementation: T1 → T2 → T3 → T4 → T5 → T6, then the explicitly requested post-merge T7. All implementation tasks share Canvas/installation lifecycle boundaries, so parallel implementation would create conflicts. The later independent code-review passes remain required. No P3 or TODO task is created.

## Engineering review completion

- Step 0: full scope retained; existing interfaces, restoration and lifecycle reused; distribution included.
- Architecture: 3 issues; code quality: 2 issues; tests: 3 gaps; performance: 2 issues. All 10 are folded into the plan and same-PR tasks.
- Failure map: produced; every introduced failure branch requires observable handling and a runnable check. Critical gaps remaining in the plan: 0. This does not claim the future code already passes them.
- NOT in scope and existing-code reuse: recorded. TODOs/follow-ups created: 0, as requested.
- Outside voice: skipped by the installed skill's `under_codex` preflight; no independent model review is claimed. Both requested implementation reviews still run after coding.
- Parallelization: one sequential implementation lane. Lake Score: 10/10 complete recommendations selected under the user's standing authorization.

## GSTACK REVIEW REPORT

| Review                  | Trigger                       | Why                                       | Runs | Status               | Findings                                       |
| ----------------------- | ----------------------------- | ----------------------------------------- | ---- | -------------------- | ---------------------------------------------- |
| CEO Review              | `/plan-ceo-review`            | Scope and product strategy                | 0    | Not requested        | Scope is the user's Issue #4 instruction       |
| Independent Plan Review | Codex outside-voice preflight | Second model opinion                      | 0    | Skipped: under_codex | No independent review claimed                  |
| Eng Review              | `/plan-eng-review`            | Architecture, quality, tests, performance | 1    | CLEAR (PLAN)         | 10 issues incorporated; 0 critical plan gaps   |
| Design Review           | `/plan-design-review`         | Product interface review                  | 0    | Not applicable       | No application UI change                       |
| DX Review               | `/plan-devex-review`          | Developer experience                      | 0    | Not requested        | Installed-package proof included in Eng Review |

Review recorded on 2026-09-07 at source commit `7b45f53`. Test-plan artifact: `~/.gstack/projects/happy-dom-extended/ryotamurakami-codex-fast-check-web-api-properties-eng-review-test-plan-20260907-225645.md`. Implementation task artifact: `~/.gstack/projects/happy-dom-extended/tasks-eng-review-20260907-225645.jsonl`. Plan clearance does not imply completed implementation or replace the two requested implementation reviews, CodeRabbit or CI.

**VERDICT:** ENG CLEARED — ready to implement after PR #8 merges.

NO UNRESOLVED DECISIONS

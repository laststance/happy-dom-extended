# Architecture

The public Jest package extends `@happy-dom/jest-environment`. Its constructor clones caller configuration, creates an environment-owned Canvas adapter, and supplies it before the upstream Window is constructed. Compatibility installers then run synchronously, so application setup modules can use the added APIs immediately.

The public Vitest package is a custom `Environment` named `happy-dom-extended` (`vitest-environment-happy-dom-extended`) for Vitest 4 and 5. In `forks` and `threads`, `setup` constructs `GlobalWindow || Window` with the owned adapter already in `settings`, calls {@link installCompatibility}, then copies Window APIs onto the worker global with Vitest's `populateGlobal`, including Node-overlapping keys. {@link importPopulateGlobal} loads it from `vitest/runtime` and falls back to `vitest/environments` only on Vitest 4.0, so Vitest 4.1 prints no deprecation warning. Teardown restores the property descriptors captured before setup. In `vmThreads` and `vmForks`, `setupVM` returns the Window itself as the VM context. Both paths join with {@link ExtendedCanvasAdapter.drain} then `window.happyDOM.close()`, not `abort()`.

The private `packages/compat` workspace owns runner-independent API repairs and native Canvas integration. tsdown bundles it into each public runtime and a private Worker bootstrap. Happy DOM is pinned to 20.14.0 because the integration uses internal lifecycle hooks. CPU Skia, Culori, WebIDL conversions and bounded image-header inspection remain external runtime dependencies. Canvas modules load skia-canvas through one CommonJS `require` in {@link loadSkiaCanvas}, so a skipped install script produces approval guidance instead of Node's bare `Cannot find module '../skia.node'`. Installed-tarball checks verify their presence, shared Happy DOM class identity and the Worker bootstrap path.

## Canvas ownership

Each default environment gets its own `ExtendedCanvasAdapter`, implementing Happy DOM's adapter interface directly. Skia supplies rasterization and PNG/JPEG/WebP codecs. This repository owns WebIDL conversion, dimensions, readiness, origin-clean state, ImageData conversion, Bitmap ownership and transfer. Installation-time shared hooks route by the receiver; per-instance dimension hooks reset the native bitmap. A stable context proxy exposes the DOM owner and Window image types while retaining native method receivers and consumer spies. The official adapter and node-canvas remain development dependencies for foreign-adapter interoperability tests.

Canvas states use a WeakMap. A set of WeakRefs allows shutdown to restore surviving instances without retaining canvases that application code discarded. Pending exports own independent native snapshots until compression and callbacks finish. Output jobs register with Happy DOM's AsyncTaskManager and with the adapter's own completion queue.

Teardown drains only the owned export queue, closes Happy DOM, restores live Canvas instances, and releases remaining compatibility repairs. Every stage is attempted even after a failure; aggregate errors retain their original cause. Repeated teardown does not run cleanup twice. Explicit programmatic custom adapters remain caller-owned.

## Media, transfer and Workers

Owned image/video requests preserve the Window's headers, cookies, loading settings and interceptors while applying subresource CORS and redirect checks. Replacing a source aborts its old operation; stale events and pixels cannot become current. FFmpeg/ffprobe run as bounded child processes with pipe-only input, one decoder thread, cancellation and joined shutdown. Video playback samples real frames against a monotonic clock; it does not provide audio playback.

Canvas transfer walks one object graph, validates the complete transfer list, and delegates native values to one native serialization operation. Synchronous clone allocates receiver storage before detaching any sender. MessagePort transport uses private identity markers and receipt acknowledgements to retain ownership until delivery. Offscreen rendering presents actual pixels to its HTML placeholder over a bounded private channel.

Dedicated Workers execute in real Node threads using a private packaged bootstrap. Classic and module loaders fetch permitted scripts through the parent Window's resource policy. The child exposes browser-facing globals and Canvas bindings in a V8 context; it is not a security sandbox. A shared Window-close hook joins media and Worker cleanup, with forced termination for blocked scripts.

## Shared repairs

Only repairs that must affect upstream shared prototypes use reference counting. The last environment releases the original descriptor. Failed restoration still releases bookkeeping, and the common disposer tries every registered cleanup before throwing. Node-native channels created by an environment are tracked and closed on shutdown.

## Boundaries

The public packages expose runner environments only; there is no Canvas stub entry. Native Canvas installation is required; video sources additionally need ffmpeg and ffprobe on PATH. The [Canvas contract](docs/canvas-compatibility.md) records supported behavior, resource ceilings, measured browser differences and exact comparison fixtures. The Vitest package reuses the compatibility workspace and does not depend on Jest.

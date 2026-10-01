# jest-happy-dom-extended

## 0.2.2

### Patch Changes

- Suppress rejections from fire-and-forget teardown so a failed cleanup after `terminate()` or Window close can no longer abort the process with an unhandled rejection. A synchronous throw while posting the worker close message no longer skips the forced-termination timer, which could previously strand the child thread and hang the Window close. Replacing a video element's source now also owns the previous source's disposal rejection. `window.happyDOM.close()` still reports joined teardown failures through `disposeAll`.
- Drop the dangling `//# sourceMappingURL` comment from published declarations; tsdown emitted it for a declaration map the tarball does not contain.

## 0.2.1

### Patch Changes

- Decode cross-realm MessageEvent envelopes and bind Canvas port `onmessage` so Worker and MessageChannel transfers still work after a runner replaces the global `MessageEvent` constructor.
- Explain a skipped skia-canvas install script. When Skia's native binary is missing, the environment now fails with the approval commands for pnpm, npm 12, and Bun instead of `Cannot find module '../skia.node'`, and keeps the original error as its `cause`.
- Stop a collected Canvas resource from aborting the process during worker teardown. Canvas presentation ports, decoded images and video sources are released from `FinalizationRegistry` callbacks. V8 reports a throw from such a callback as an uncaught exception, and a worker collecting a handle while tearing its environment down turned that into `SIGABRT`, which surfaced as a whole test run exiting with code 134 rather than a failing test. The video finalizer also discarded an async cleanup's promise, so a rejection from it had nothing attached. Each finalizer now releases through a helper that keeps both a throw and a rejection inside the callback.

## 0.2.0

### Minor Changes

- b0e423d: Provide real Canvas and OffscreenCanvas 2D rendering during Jest setup files using CPU Skia. Own dimension resets, WebIDL validation, sRGB/P3 byte ImageData, image readiness/CORS, Bitmap storage and PNG/JPEG/WebP output. Preserve call-time snapshots, Window identity, shared arrays, custom adapters and complete resource cleanup. Remove the non-rendering `/canvas` helper entry. Runtime dependencies now include `skia-canvas`; its native installation must be permitted by the package manager. Pin the Happy DOM runtime pair to the verified 20.14.0 internal interfaces.

  Add actual dedicated Workers, atomic ImageBitmap/OffscreenCanvas transfer and HTML placeholder presentation. Add real video Canvas sources using optional ffmpeg/ffprobe executables on PATH. Bound native storage, transport queues and child processes, join teardown, and document measured renderer differences and unsupported APIs.

  Expand installation, usage, contribution, testing, architecture, and security documentation. Validate Node 22, 24, and 26 on Linux and Windows, report coverage to Codecov, and run dedicated security, Scorecard, and repository health workflows.

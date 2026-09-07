# jest-happy-dom-extended

## 0.2.0

### Minor Changes

- b0e423d: Provide real Canvas and OffscreenCanvas 2D rendering during Jest setup files using CPU Skia. Own dimension resets, WebIDL validation, sRGB/P3 byte ImageData, image readiness/CORS, Bitmap storage and PNG/JPEG/WebP output. Preserve call-time snapshots, Window identity, shared arrays, custom adapters and complete resource cleanup. Remove the non-rendering `/canvas` helper entry. Runtime dependencies now include `skia-canvas`; its native installation must be permitted by the package manager. Pin the Happy DOM runtime pair to the verified 20.14.0 internal interfaces.

  Add actual dedicated Workers, atomic ImageBitmap/OffscreenCanvas transfer and HTML placeholder presentation. Add real video Canvas sources using optional ffmpeg/ffprobe executables on PATH. Bound native storage, transport queues and child processes, join teardown, and document measured renderer differences and unsupported APIs.

  Expand installation, usage, contribution, testing, architecture, and security documentation. Validate Node 22, 24, and 26 on Linux and Windows, report coverage to Codecov, and run dedicated security, Scorecard, and repository health workflows.

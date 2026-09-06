# Canvas rendering: baseline and corrections

Baseline examined: Happy DOM and its official Canvas adapter 20.14.0; node-canvas 3.2.3; Jest 30.0.0 and 30.5.1. This document records reproduced behavior and the implementation boundaries of Issue #2.

## Primary sources

- [Happy DOM Canvas adapter source](https://github.com/capricorn86/happy-dom/tree/v20.14.0/packages/@happy-dom/node-canvas-adapter): bridge from DOM objects to node-canvas.
- [node-canvas 3.2.3](https://github.com/Automattic/node-canvas/tree/v3.2.3): rendering, native dependencies, codecs, and platform support.
- [HTML Canvas serialization](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob): copy the bitmap before parallel serialization, callback delivery, and output fallback behavior.
- [OffscreenCanvas serialization](https://html.spec.whatwg.org/multipage/canvas.html#dom-offscreencanvas-converttoblob): promise-based output and errors.
- [Jest configuration](https://jestjs.io/docs/30.0/configuration): JSON-serializable configuration and environment lifecycle.

## Reproduced gaps repaired here

The upstream native encoder used the original bitmap during asynchronous output: requesting red output and immediately drawing blue could encode blue. The internal adapter copies pixels first and releases that copy when output finishes. Native output also needed explicit registration with Happy DOM's asynchronous task manager so `waitUntilComplete()` could observe it.

Dimension changes did not consistently update the native target. Per-instance hooks now reset dimensions, pixels, and drawing state, including same-value assignments and HTML attribute assignment/removal. A context view preserves the DOM owner, stable methods, consumer spies, and Window ImageData arrays without overwriting node-canvas's internal canvas reference.

A custom instance placed in ordinary Jest configuration loses methods when passed through JSON serialization to workers. The environment now creates its own default adapter inside each worker; direct construction and subclasses can supply caller-owned instances. Existing options and explicit false/null values are preserved.

Earlier sequential cleanup could stop after one restoration failure. Cleanup now attempts all restorers, preserves original errors, and releases shared ownership bookkeeping even when restoration fails. Canvas states are weakly owned; only active encoders retain snapshot bitmaps.

The bridge also resolves native drawing sources owned by caller-supplied official adapters. When a source-built node-canvas omits JPEG support, its asynchronous JPEG encoder never calls back; capability-aware format selection uses real PNG output instead and keeps completion observable.

## Evidence and limits

The tests inspect literal red/blue/transparent RGBA values, decode actual PNG independently with pngjs, decode JPEG with tolerance, exercise setup modules, mix ESM/CommonJS lifetimes, and check installed-package serial/two-worker execution. See [TESTING.md](../../TESTING.md) and the [verification record](../verification.md).

This does not establish full WebIDL validation, all attribute mutation routes, origin-clean/CORS state, unloaded-image semantics, ImageBitmap/Worker transfer, video drawing, WebGL, or browser-identical fonts, anti-aliasing, color handling, and codecs. These remain documented backend/upstream limitations. No no-op implementations are supplied for them, and fixed-value mocks belong in application tests.

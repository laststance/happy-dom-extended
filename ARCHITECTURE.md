# Architecture

The public Jest package extends `@happy-dom/jest-environment`. Its constructor clones caller configuration, creates an environment-owned Canvas adapter, and supplies it before the upstream Window is constructed. Compatibility installers then run synchronously, so application setup modules can use the added APIs immediately.

The private `packages/compat` workspace owns runner-independent API repairs and native Canvas integration. tsdown bundles it into one public CommonJS runtime. ESM imports and CommonJS require resolve to that runtime, sharing prototype ownership. Happy DOM, its official Canvas adapter, and canvas remain external runtime dependencies. Installed-tarball checks verify that their resolved Happy DOM classes agree.

## Canvas ownership

Each default environment gets its own `ExtendedCanvasAdapter`. Native drawing delegates to the official adapter. Per-instance dimension hooks synchronize the native bitmap; a stable context proxy exposes the DOM owner and Window image types while retaining native method receivers and consumer spies.

Canvas states use a WeakMap. A set of WeakRefs allows shutdown to restore surviving instances without retaining canvases that application code discarded. Pending exports own independent native snapshots until compression and callbacks finish. Output jobs register with Happy DOM's AsyncTaskManager and with the adapter's own completion queue.

Teardown drains only the owned export queue, closes Happy DOM, restores live Canvas instances, and releases remaining compatibility repairs. Every stage is attempted even after a failure; aggregate errors retain their original cause. Repeated teardown does not run cleanup twice. Explicit programmatic custom adapters remain caller-owned.

## Shared repairs

Only repairs that must affect upstream shared prototypes use reference counting. The last environment releases the original descriptor. Failed restoration still releases bookkeeping, and the common disposer tries every registered cleanup before throwing. Node-native channels created by an environment are tracked and closed on shutdown.

## Boundaries

The public package exposes the Jest environment only; there is no Canvas stub entry. Native Canvas installation is required. This implementation supports verified 2D behavior and image output rather than complete browser Canvas conformance. The [package guide](packages/jest-happy-dom-extended/README.md#runtime-boundaries) documents current limits. The reserved Vitest workspace can reuse the compatibility package in a future phase without depending on Jest.

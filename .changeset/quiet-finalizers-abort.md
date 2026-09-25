---
'vitest-environment-happy-dom-extended': patch
'jest-happy-dom-extended': patch
---

Stop a collected Canvas resource from aborting the process during worker teardown.

Canvas presentation ports, decoded images and video sources are released from
`FinalizationRegistry` callbacks. V8 reports a throw from such a callback as an
uncaught exception, and a worker collecting a handle while tearing its
environment down turned that into `SIGABRT`, which surfaced as a whole test run
exiting with code 134 rather than a failing test. The video finalizer also
discarded an async cleanup's promise, so a rejection from it had nothing
attached. Each finalizer now releases through a helper that keeps both a throw
and a rejection inside the callback.

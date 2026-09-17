---
'jest-happy-dom-extended': patch
---

Decode cross-realm MessageEvent envelopes and bind Canvas port `onmessage` so Worker and MessageChannel transfers still work after a runner replaces the global `MessageEvent` constructor.

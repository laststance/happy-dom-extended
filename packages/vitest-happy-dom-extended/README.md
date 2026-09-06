# vitest-happy-dom-extended

Reserved private workspace for the next development phase. It contains no Vitest environment implementation and is not published.

The future adapter should create or receive a Happy DOM Window, call `installCompatibility` from the private `@happy-dom-extended/compat` workspace, and invoke its disposer during teardown. It must bundle that shared source into its own distribution, as the Jest adapter does. Jest is not a dependency of the shared layer.

Before implementing this adapter, verify the current Vitest custom-environment lifecycle and pool behavior, then add Vitest-specific lifecycle and isolation tests. Only remove `private: true` once those tests and package checks pass.

# M0 finding: rc.2 SlotRegistry runtime-entry semantics

## Finding

The approved design's phrase “SlotRegistry registration is render-erased, so the official component cannot be captured” is factually imprecise.

In rc.2, `SlotRegistry.entries(key)` delegates to `SlotCore.entries(key)` and returns `StoredEntry[]`. The runtime renderer reads `entry.component`, so the component function remains present at runtime. “Render-erased view” means the registration's compile-time relationship among owner props, injected props, store seats, child slots, locale and component props is erased from the inspection type. It does not mean the component field is removed.

Direct installed rc.2 evidence:

- `dsh-client-runtime/lib/types/client/slots.d.ts:125-139` calls `entries()` a render-erased inspection view and separately exposes elected winners.
- `dsh-client-runtime/lib/client.js:175-193` directly delegates both raw entries and winners to SlotCore.
- `dsh-client-runtime/lib/client.js:243-282` passes the component into SlotCore, while store resolution and Host renderer faces remain internal to SlotRegistry.
- `dsh-client-ui-renderer/lib/client.js:628-715` reads `entry.component` and assembles standard props, injected props, store actions, hooks, locale and owner props through private renderer helpers.
- `dsh-client-ui-renderer/lib/client.js:741-847` renders child slots only through an outlet with the private renderer Host face; there is no public “render this StoredEntry under a new owner” API.

## Architectural impact

The conclusion that a runtime wrapper is not a valid NodeSection reuse seam still holds, for stronger and more precise reasons:

1. Reading `entry.component` alone does not produce the official composed props.
2. The public SlotRegistry has no child-entry render method; `renderSlot` is root-only.
3. Reimplementing renderer prop assembly would depend on private cache/store/inject/provider behavior and be more fragile than the fixed-source extraction.
4. Rendering the already assembled full `WorkspaceBrowser` once per Node would repeat its section header, global search, view controls, rail controls, directory-flow slot, and dialogs.
5. Capturing the full component and manually fabricating its `WorkspaceBrowserProps` would still instantiate the full shell and would not expose the internal `SessionTree`/`FlatList` boundary.

Therefore the fixed-commit build-time extraction of `Rc2WorkspaceNodeSection` remains the appropriate seam. No fallback to a complete WorkspaceBrowser rewrite is needed.

## Required OpenSpec correction

Before task 1.8 can pass, approved artifacts should replace claims that the component is absent/cannot be captured with:

> SlotRegistry inspection preserves an untyped `StoredEntry.component`, but erases the typed composition relationship and exposes no public renderer operation that can reassemble or nest that entry with its standard props, injected hooks, store instance, locale, scoped providers and child slots. Capturing the component alone is not a supported embed seam; rendering full WorkspaceBrowser instances would duplicate the shell.

Task 1.8 should test and record both facts:

- raw entries retain the component but not a supported typed/re-rendering seam;
- complete WorkspaceBrowser instances duplicate the outer shell.

## Gate status

- Runtime wrapper approach: **REJECTED as unsupported**, with direct evidence.
- Fixed-source NodeSection extraction: **still supported**.
- Approved wording correction: **APPLIED** in `design.md` and `tasks.md`.
- Runtime executable guard: **PASS** — a synthetic rc.2 `SlotCore` entry retains the exact component function while its public core has no render/renderEntry/renderSlot operation; published declarations type `component` as `unknown` and injected args as `never[]`.
- Full-browser shell guard: **PASS** — the fixed-source patch keeps search/picker/renderSlot/header/view controls outside NodeSection and makes the official browser delegate to the shared section.
- Task 1.8: **PASS**.
- Fixed-source NodeSection extraction remains the only accepted reuse seam for this change.

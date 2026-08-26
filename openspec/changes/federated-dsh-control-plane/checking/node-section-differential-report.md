# rc.2 NodeSection black-box differential

## Oracle

The patched official `WorkspaceBrowser` and a standalone `Rc2WorkspaceNodeSection` are mounted simultaneously from the same verified patch artifact. Both receive equivalent synthetic Session/Workspace snapshots, independent instances of the official view store initialized to the same state, and action spies with identical behavior.

The official comparison target is its descendant marked:

```text
data-rc2-workspace-node-section="official-local"
```

The extracted comparison target is marked with its synthetic node id. Header/search/rail/picker nodes outside those descendants are intentionally excluded because the approved ownership matrix assigns them to the official root browser or the federated Node shell.

## Covered behavior

The executable differential in `tests/federation-node-section.test.mjs` compares and exercises:

- grouped Workspace and Session row order;
- blank-session visibility/title/selection;
- `role=treeitem`, `aria-expanded`, `aria-selected`, and draggable state;
- pending-interaction, running, completed and running-subagent status dots/copy;
- official HoverCard content and non-blank copy text;
- deterministic overflow/show-more expansion;
- session menu portal ownership, labels, and fork action routing;
- session rename dialog role/name/input ARIA and dismissal;
- reduced-motion CSS retained in the generated bundle;
- explicit shell difference: official search chrome exists, extracted NodeSection has none.

The same patched component implementation is used in both arms. The differential is therefore a regression guard against prop/injection divergence rather than a comparison to a separately reimplemented tree.

## Keyboard and motion boundary

The subtree's dialog input key handling and accessible labels are exercised in JSDOM. Escape dismissal of the real rc.2 Modal primitive is covered by the upstream primitive; this repository's focused primitive double intentionally retains only portal, role, class, menu dispatch and close-button semantics, so this test does not pretend to re-prove that external package's internal document listener.

Both official and extracted arms include the exact same source CSS. The generated CSS is checked for `prefers-reduced-motion: reduce`; visual animation timing itself is not asserted in JSDOM.

## Result

Task 1.7: **PASS**. The single-node extracted subtree is black-box equivalent to the official browser's delegated subtree for the covered behavior. Observed differences are limited to approved shell ownership and the node-scoped portal namespace.

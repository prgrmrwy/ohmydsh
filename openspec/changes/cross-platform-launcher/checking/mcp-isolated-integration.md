# Exact MCP bridge integration — isolated candidate, 2026-10-25

## Scope

Reused packages already installed in the user-authorized independent corp-mac candidate `/private/tmp/ohmydsh-macos-acceptance-sDkoXh8y`. No new package install/download, actual Host, desktop automation, credentials or external MCP service. Existing checkout and port3080 were not used.

Copied the unchanged repository MCP seam test and its builtin-only stdio JSON-RPC fixture into a new probe directory. The root suite lacks the bridge package by design, so this is separate integration evidence, not a modification of root dependencies or skip handling.

## Failure investigation

First probe linked the installed profile bridge and root tool packages: process exit0, **2 skipped**, not a passing integration result. Direct import identified missing `@deepseek-ai/dsh-scope` peer inside the profile graph. This exposes a limitation of the existing test's generic ERR_MODULE_NOT_FOUND skip guard: nested missing peers can also be skipped. No claim of product bridge failure or test success was made from this attempt.

Inspected the bridge dependencies and exact peers. Prepared a new probe-local graph from the already-installed official CLI node_modules, copied the exact bridge into that graph, and separately required its import to succeed before starting the unchanged test. Original profile/official dependency directories were not modified. No install scripts executed. The standalone probe runner is `corp-mac-mcp-probe.mjs`.

## Fresh result

Job bash-576, exit0:

- bridge import with complete official peers: PASS;
- real DSH MCP bridge exposes a typed tool and dispatches it: PASS;
- disposing the real bridge unregisters the MCP tool: PASS;
- **2 tests / 2 pass / 0 fail / 0 skipped**, approximately250ms.

Bridge/tool-runtime/system-prompt are exact0.2.0-rc.2; framework4.0.4. This proves typed schema discovery, structured local stdio dispatch and disposal against the installed official graph. It is not a TypeSafe/live external service test, and does not retroactively change the root595/593/0/2 invocation into a zero-skip invocation. The strict Anvil zero-skip completion criterion remains unsatisfied by the root command itself.

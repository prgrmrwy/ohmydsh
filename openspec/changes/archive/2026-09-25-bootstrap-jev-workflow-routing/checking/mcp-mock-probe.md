# DSH MCP bridge mock probe

Date: 2026-09-23

This probe uses the exact `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2` with the repository's actual Cordis, system-prompt and tool-runtime packages. The stdio peer is a local JSON-RPC/MCP fixture, so no credential or external service is involved.

Command:

```text
node --test tests/dsh-mcp-client-seam.test.mjs
```

Result:

```text
✔ real DSH MCP bridge exposes a typed tool and dispatches it
✔ disposing the real bridge unregisters the MCP tool
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

What this proves:

- the package is a real DSH plugin seam rather than configuration-only evidence;
- initial MCP discovery registers `mcp__mock__typed_decide` in `ctx.tools.schemas()`, the same surface projected into an Agent request header;
- the registered input schema contains the fixture's required `candidate` field;
- dispatch through the real ToolRuntime reaches the stdio server and preserves structured output `{ selected: "anvil", confidence: 0.99 }`;
- Cordis disposal closes the bridge generation and unregisters the tool from the retained ToolRuntime.

This does not claim a live TypeSafe call. The current apply process has no `TYPESAFE_API_KEY`, so task 3.4 remains pending. It also does not replace the later real ordinary-Agent request-header probe after the generated profile row is installed.

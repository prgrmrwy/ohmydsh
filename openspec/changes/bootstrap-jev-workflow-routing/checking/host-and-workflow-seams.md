# DSH 0.1.5 host and workflow seams

## Conclusion

DSH 0.1.5-rc.2 has a real generic MCP bridge, so Jev business logic does not need to be copied. A narrow process launcher is still required to meet this change's stricter environment boundary: the generic bridge removes secret-shaped and `DSH_*` ambient names but deliberately preserves ordinary ambient variables, so it is not by itself a strict allowlist for the Jev child.

spec-superflow can be installed unmodified, but its full planned execution is not safe inside an active DSH Worktree Session: upstream `isolate` may switch/create branches or a second worktree, and upstream `finish` performs merge/worktree removal/branch deletion. Those nested Git operations are invisible to the outer Bash tool guard. Therefore an active managed Worktree Session makes spec-superflow unavailable as an executable routing candidate until an independently verified command firewall or upstream-compatible host mode prevents those operations. Phase one still installs and validates its explicit entry outside that conflict; the router removes unhealthy/incompatible candidates.

## MCP assembly

- Package: exact `@deepseek-ai/dsh-mcp-client@0.1.5-rc.2`, installed as a bundle-less profile dependency.
- One ordinary profile composition row starts a stdio server and registers its tools on `ctx.tools`.
- Public names are stable `mcp__<serverName>__<rawName>`. `serverName: jev` yields `mcp__jev__jev_classify` and `mcp__jev__jev_decide` (and the other upstream Jev tools).
- The row is in the ordinary profile scope, not the Pet-only preset. A duplicate server name in one scope fails rather than silently colliding.
- The executable is the exact profile-installed package through a generated launcher and Node; it never uses floating `npx` resolution.
- Missing credential disables the row. `failOnStartupError: false` preserves Host/Agent startup if Jev is absent or broken.

### Lifecycle evidence from the reviewed package

- Calls forward the tool execution abort signal and configured per-call timeout to MCP `tools/call`.
- The bridge effect disposer cancels reconnect, closes the MCP client/stdio child, waits for generation settlement, unregisters tools, and releases the namespace.
- Reconnect is bounded. After exhaustion tools are removed until configuration reload/restart.
- Initial connect/discovery is bounded by the MCP SDK default rather than a separate DSH discovery deadline; this remains a known startup-latency limitation.

### Environment boundary

The bridge builds `{...scrubbedParentEnv(), ...explicitEnv}`. That protects common secret/DSH variables but still carries non-secret ambient values. The generated launcher therefore starts the actual Jev process with a new explicit environment instead of spreading `process.env`:

- one credential value: `TYPESAFE_API_KEY`;
- deterministic non-secret provider selection: `JEV_PROVIDER=typesafe`;
- only documented runtime essentials if required to execute Node and resolve temporary/home paths.

It must not inherit project `.env` content wholesale, provider alternatives, endpoint overrides, arbitrary proxy/config variables, or raw errors. The launcher forwards stdio, termination/cancellation, and the child exit code only; it does not implement or transform Jev tools.

## Proof required beyond configuration

Files, package presence, generated composition, and “ready” logs are not proof that an Agent received tools. Acceptance needs:

1. an isolated mock stdio server mounted through the exact bridge row;
2. a real ordinary Agent request header whose tool surface contains the expected qualified name;
3. one typed mock tool invocation with validated output;
4. an in-flight cancellation/dispose probe proving request and child termination;
5. missing-key and bad-server cases showing ordinary Agent startup still succeeds;
6. a live TypeSafe probe only after the local key is securely available.

The current apply environment reported only whether the key exists and found it absent; no secret was read or printed. Live validation is therefore pending rather than faked.

## Anvil seam

- Exact upstream directory: `schemas/anvil` at commit `73eea60c622712a5d952ec1aec62da4e349f8c33`.
- Target: OpenSpec user schema directory, default `~/.local/share/openspec/schemas/anvil`; managed by ohmydsh and shared across checkouts/worktrees.
- Selection: `openspec new change <name> --schema anvil`.
- `openspec/config.yaml` remains `schema: spec-driven`.
- Anvil has no worktree orchestration. Its review/TDD/verify gates remain agent-honored instructions; OpenSpec validates artifact structure/existence, not canonical verdict contents.
- The materializer validates archive and selected-tree hashes and refuses local drift; generated content is never hand-edited.

## spec-superflow seam

The npm package is a version unit containing both the nine original skills and their bundled CLI/runtime. Each skill expects its package root exactly two levels above its `SKILL.md`; copying individual skill directories to the normal DSH skill root would break that invariant.

Correct mounting therefore uses the profile-installed full package plus a dedicated `@deepseek-ai/dsh-skill-filesystem` provider whose `bundledSkillDir` is the package's original `skills/` directory and whose default roots are disabled. This preserves all upstream bytes and bundled-runtime path calculations. Upstream platform installers, hooks, and phase guard are not installed. Discovery health must check all expected skill names and detect collisions, since names such as `build-executor` and `code-reviewer` are generic.

### Worktree Session boundary

Inside a managed Worktree Session:

- never invoke upstream `ssf isolate` (with or without its own worktree);
- never invoke upstream `ssf finish` or physical integration/cleanup;
- never let SSF branch management replace the bound `ws/*` task branch;
- dependency mutation still requires Worktree Session promotion;
- DSH controlled merge/archive/cleanup remains authoritative and requires its existing explicit approval.

Because upstream planned skills instruct isolation and the user requires unmodified upstream reuse, warnings are insufficient. Until an external enforcement mechanism is implemented and tested, the router marks spec-superflow unavailable in a bound Worktree Session rather than pretending the conflict is solved.

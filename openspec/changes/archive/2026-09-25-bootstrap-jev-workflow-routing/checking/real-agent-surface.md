# Real ordinary-Agent surface probe

Date: 2026-09-25

The probe located the current session from the Host-injected `DSH_SESSION_ID`, decoded its v3 event container read-only, and retained only event counts, request-header tool names, and booleans/names from the injected skill catalog. No prompt, assistant text, source, path, identifier, attachment, or credential was copied into evidence.

## Defect found and corrected

The first real probe found:

- the local `jev-workflow-router` skill was present;
- all nine spec-superflow skills were absent;
- 16 ordinary-Agent request headers each contained 40 tools and no `mcp__jev__*` tools.

Missing Jev tools were expected because the Host has no `TYPESAFE_API_KEY`. Missing spec-superflow skills were not expected. The generated profile patch used top-level `{id, name}` rows. In DSH composition, that shape overrides an already-existing row with the same id; it does not insert a new unknown id. Therefore both generated third-party plugin rows were silently ignored despite valid YAML, installed packages, passing health checks, and successful isolated plugin probes.

The resource renderer now emits each new plugin as an explicit `- insert:` patch. Tests assert that both rows use insertion form and reject the ineffective top-level unknown-id shape.

## Real surface after correction

After normal sync, the current ordinary Agent received a refreshed `skill-catalog` containing:

- `jev-workflow-router`;
- `bug-investigator`;
- `build-executor`;
- `code-reviewer`;
- `contract-builder`;
- `need-explorer`;
- `release-archivist`;
- `spec-merger`;
- `spec-writer`;
- `workflow-start`.

This is runtime request-context evidence, not package/config/log presence. It also proves the full-package mount preserves all nine upstream skills without copying individual skill directories.

The latest completed request header still has no `mcp__jev__*` names, which is the required missing-credential surface: the bridge row is dynamically disabled and the ordinary Agent retains its existing 40-tool surface. The non-secret readiness probe reports exact packages and both insertion rows healthy, `credential.currentProcess:false`, `credential.privateEnvDeclaration:false`, and `valueInspected:false`. A positive Jev tool/call probe remains gated on a replacement key configured outside chat and a subsequent Host restart; the procedure is fixed in `live-probe-runbook.md`.

The router remains shadow-only. During this probe it did not create a change, switch schema, invoke `ssf`, create another worktree, merge, archive, or alter the existing change's control plane.

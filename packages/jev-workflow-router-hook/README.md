# dsh-jev-workflow-router-hook

English · [简体中文](README.zh.md)

<!-- problem -->
The `jev-workflow-router` skill only runs if the model remembers to call it. When the model proposes an OpenSpec change on its own, it tends to treat the project rule as already settled and skips the router. This host plugin closes that gap: when an agent is about to create a change and has not used the router yet, it attaches one short reminder to the tool result.

**Install.** Managed through `dsh.yaml` (entry `jev-workflow-router-hook`, `source: local`): set `enabled: true`, run `dsh build`, then restart DSH. Spec: OpenSpec `jev-workflow-routing`, change `add-jev-router-openspec-reminder-hook`.

## Behavior

- Listens on `tools/post-execute`. Triggers: a `skill` call with `name: "openspec-propose"` (main trigger, before the change exists), or a `bash` command containing `openspec new change` (fallback; the change already exists by then).
- Reminds only if the same agent has not loaded `jev-workflow-router` and has not called a tool whose name ends in `jev_classify` or `jev_decide`, and at most once per agent. Sub-agents and forks count separately.
- The reminder is a labelled notice (`source.kind: jev-workflow-router-hook`) prepended to `additionalContexts`. The tool result, a downstream `block` and other contexts are kept unchanged.
- Silent when `$DSH_HOME/skills/jev-workflow-router/SKILL.md` is missing (router skill disabled) or `DSH_JEV_WORKFLOW_ROUTER_DISABLED` is `1`/`true`/`yes`/`on`.
- Known limits: state lives in memory, so a session restored after a host restart may get one extra reminder; `openspec new change` run indirectly (script, alias) is not detected.

## Boundaries

Never blocks, denies or rewrites a call, never calls Jev, writes no files and makes no network requests. Whether to call the router is still the agent's decision under the skill's own skip rules.

## Removal
<!-- section: removal -->

Connects the DSH tool pipeline to the `jev-workflow-router` skill. Remove it by setting `enabled: false` in `dsh.yaml`, running `dsh build` and restarting DSH; it keeps no data. Disabling the router skill alone already silences it.

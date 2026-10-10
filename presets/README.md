# presets/ — agent preset customizations

English · [简体中文](README.zh.md)

<!-- problem -->
A preset decides which tools and composition an agent session gets. This directory holds the presets this repository defines itself, for the rare case where a session needs a roster that differs from the official `standard` preset; today that is the Pet executor preset.

The official `standard` preset loads automatically, and environment-level general guidance is materialized from the top-level `agentInstructions` into `$DSH_HOME/AGENTS.md`. Do not copy the official preset merely to carry model guidance; keep such singleton guidance in `instructions/` and deploy it through `agentInstructions`. Add a new preset only when a separate roster/composition is really needed.

The only preset today is `dsh-pet-executor` (the Pet task executor session, which differs from `standard` only in not loading skill-filesystem).

Each subdirectory is one preset:

```
presets/<id>/
  agent.cordis.yml     # preset composition (required; the roster recognizes agent.cordis.yml)
  preset.yml           # display metadata (name / description)
  VERSION              # independent version
  CHANGELOG.md
```

- On DSH 0.2+ sync does not copy a directory: it renders each enabled preset as one `@deepseek-ai/dsh-agent-preset` declaration row (`id: preset-<id>`) into the profile patch, taking `plugins` from `agent.cordis.yml` and the display `name`/`description` from `preset.yml`, and removes through its ledger any directory copy left by DSH 0.1.x under `.agent-presets/`;
- After a change, rerun sync; **do not edit anything under `~/.dsh` directly** (the source of truth is this repository);
- Start a new preset from a shipped preset (see `config/agent-presets/` in the deployment, or `agentPresets.copy()`) so that the composition is guaranteed to load.

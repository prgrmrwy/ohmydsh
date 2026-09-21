# Archify and remote-plugin review boundary

- `archify-dsh@0.1.0` remains the only complete Archify Skill source in this repository and must not be removed as a duplicate. Its target-runtime gate is still pending: a target profile must prove one provider plus generate, validate, deliver, visual-check and export behavior.
- `dsh-width-tiers@1.0.5` is a target-runtime candidate because its rightbar/details seam changed; its old `1.0.4` pin remains the rollback until target loader and width behavior pass.
- `dsh-cockpit-bridge@0.4.0` requires target selection/pending snapshot and editor-open smoke; current `0.3.0` remains rollback.
- `dsh-opencode-session-header@0.1.0` remains pinned. Target-domain header injection and non-target-domain negative behavior still require target-runtime smoke.
- The user-selected removals `open-in-vscode`, `sidebar-qa`, and `setting-restart` are already absent from `dsh.yaml`; `better-sidebar` and local `session-links` remain.

Static audits do not constitute task completion. These items remain in the runtime/remote acceptance queue until actual target loader activation and user-visible behavior are recorded.

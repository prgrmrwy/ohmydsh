# Old Runtime Isolated Sync

The first attempt against the untouched `0.1.2-rc.1` manifest reached `dsh-setting-restart@1.0.0` and failed because the configured package source returned HTTP 404 from `bnpm.byted.org`. This is the user-selected removal decision, not a target-runtime compatibility result.

After removing `open-in-vscode`, `sidebar-qa`, and `setting-restart` from `dsh.yaml`, the old runtime profile was materialized in a task-local `DSH_HOME` with `DSH_PROFILE=web` and `DSH_SKIP_UPDATE=1`:

- First sync: exit 0; profile scaffold, dependencies, local bundles, skills, preset and generated patch were created.
- Second sync: exit 0; reported `no changes — deployment already matches manifest`.
- Official `@deepseek-ai/dsh@0.1.2-rc.1 --profile web --dump-config`: exit 0.
- Startup manifest summary: every current enabled customization appeared exactly once; the three removed entries were absent. Archify appeared as one skill filesystem bundle, and `better-sidebar` remained present for `session-links`.
- The temporary `DSH_HOME` and logs were removed after the summary was recorded.

This is an isolated old-runtime deployment baseline, not a production deployment and not evidence that the incomplete Pet/Worktree old dependency tree is compatible. The full package baseline and its known dependency gaps are in `baseline-0-1-2.md`.

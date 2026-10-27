# Screenshots

| file | kind | source | date | reviewer | verdict | note |
|---|---|---|---|---|---|---|
| model-picker.gif | screenshot | isolated DSH_HOME instance (temp HOME/XDG/DSH_HOME under /tmp, port 3199), synthetic data: local mock Magpie gateway on loopback with demo models, Playwright video from the real Web UI | 2026-10-27 | lead | pass (viewed frames: demo workspace, mock models and mock account only; no hostname, user, path, token or real session) | Model picker grouped by upstream provider, search, model switch and the per-session standard/fast control |
| settings.gif | screenshot | same isolated instance and recording approach as model-picker.gif; mock Magpie gateway serves the catalog and synthetic usage cards | 2026-10-27 | lead | pass (viewed frames: settings section only; key field shows the launch-environment marker, access fields contain demo values, account row is synthetic) | Settings → Magpie: connection, Cloudflare Access mode, provider groups (visibility, default effort), usage card refresh |

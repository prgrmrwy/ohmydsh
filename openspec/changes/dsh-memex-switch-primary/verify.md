# Verify — dsh-memex-switch-primary

Date: 2026-09-29. Runs against dsh-memex 0.3.0, DSH 0.1.5-rc.2, and the live `~/.dsh/settings.yaml`.

## Automated

| Check | Result |
| --- | --- |
| `npm run typecheck` (packages/dsh-memex) | exit 0 |
| `npm run build` (packages/dsh-memex) | host + client build complete |
| `npm test` (packages/dsh-memex) | 26 files, 333 tests passed |
| `npm run check:descriptions` | matches @touchskyer/memex@0.4.1 |
| repo `npm test` | 241 pass, 0 fail, 2 skipped |
| `npm run check:artifacts` | tracked paths comply |
| `openspec validate dsh-memex-switch-primary --strict` | valid |
| test-plan.md | every row 🟢 |

## Deploy

- The first `node scripts/sync.mjs` applied 2 changes. The second reported "no changes — deployment already matches manifest".
- DSH was restarted with `dsh restart --no-open` in a new session (`start_new_session`) with the proxy variables removed. The `dsh web` PID changed from 33863 to 24387, and http://127.0.0.1:3080 came back.
- This startup's window in `~/.dsh/dsh.log` (from the last `dsh web: http://` line on) has no error lines.

## Live acceptance (agent-browser, isolated session `memex-verify-030`)

The `dsh-memex` section of the settings file was backed up read-only before any change, to `/tmp/settings.before-0.3.0-verify.yaml`.

1. **Roles are shown.** The ohmydsh and dsh-cockpit blocks each show one row, `主 personal`. Every other block labels each row 主 or 附, including the `附 personal 兜底入口` rows.
2. **Closing ohmydsh does not close dsh-cockpit.**
   - Unchecking 记忆 on ohmydsh moved only ohmydsh into 「已关闭记忆 (2)」; dsh-cockpit stayed on.
   - Save wrote `scopes` unchanged plus `workspaces: [{ path: /Users/me/mydir/opensource/ohmydsh, memory: false }]`. No field was written on the `personal` entry.
   - After 刷新, the Host reported ohmydsh `memory=false` and dsh-cockpit `memory=true`.
   - From this ohmydsh session, `memex_recall` immediately refused: "Memory is off for this workspace (scope personal); turn it back on in Settings → 记忆". This is the "tools take effect immediately" rule.
   - Re-checking ohmydsh inside the folded group and saving wrote `workspaces: []`, and `memex_search` worked again.
3. **Switch primary and back** on `learning` (derived primary `documents-learning`, fallback `personal`).
   - 设为主入口 on the `personal` row showed 「/Users/me/Documents/learning 的主入口：documents-learning → personal」.
   - Save added `/Users/me/Documents/learning` to `personal.pathPrefixes`, and the block showed `主 personal` alone.
   - 替换主入口 → `documents-learning · 派生，未声明` showed 「…：personal → documents-learning」.
   - Save removed the path from `personal` and declared `documents-learning` with that path. This is by design: a replacement claims the path.
   - To get back to the original derived state, 移除 on the `documents-learning` row returned the block to `主 documents-learning 派生，未声明`. That left a pathless `documents-learning` configuration block, which shows read-only switches with 「该入口不认领路径」. Removing that too and saving restored the section.
4. **Original state restored.** Compared with the backup, the file differs only in two ways; neither changes routing:
   - `publish: external` is now written out on `team-sample-runtime`. It is the schema default, which the settings snapshot returns filled in; 0.2.0's save wrote it the same way.
   - An empty `workspaces: []` was added.

## Observations

- A primary switch round trip onto a derived library does not return to "derived, undeclared": the switch declares the derived library because it now claims the path. Getting back to derived takes an explicit 移除 on that entry, then on its leftover pathless block.

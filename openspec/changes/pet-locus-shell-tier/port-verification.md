# Shell-tier narrow port verification

## Scope and provenance

- Reference: session `session-c6978c4f-980b-4c2a-a807-ff1ede1c9d9c`, final human choice and handoff: port **shell-tier only** onto a fresh main-based Worktree Session; do not carry the roster→inquiry fix or broadly merge the old branch.
- Target review base: `20e41ea8abe9551c29a4fd579834f006b17ea8c4`.
- Source committed baseline: `ws/locus-dsh-pet-preset` at `c6cfba4672d21cc2ef942e294d2699de1bce2f83`; shell-tier was still uncommitted there.
- Recovered the exact authorized session with the installed official read-only Session export endpoint. The export contained 13,311 records, including pre-compaction history. Only complete reads and successful literal edits were used for reconstruction; truncated tool results were not treated as full source files. Raw session evidence and recovery scratch files are not retained in the repository.
- Changes are limited to Pet shell-tier source/tests, its active change and ADR, plus the applicable integration note. No edits to collaboration/inquiry implementation, Worktree Session, manifest, dependencies, or current published specs.

## Adaptation to current main

1. Preserve `LOCUS_CHILD_PRESET`, explicit child-preset capability checks and cold-restore behavior; overlay the shell-capable durable filter instead of restoring parent-derived composition.
2. Preserve `pet_locus_request_execution` in the caller-bound allowlist and existing todo dispatch/UI behavior.
3. Preserve the improved `/bind` refusal semantics and current fixture paths.
4. Carry current spec's explicit child-preset requirements and both added scenarios into the MODIFIED delta. Strict validation initially rejected their omission; corrected without changing published specs.
5. Reconcile a dispatch-object reconstruction discrepancy with the later complete reference read; do not keep stale intermediate wiring.
6. Fix a historical test edit that accidentally used an out-of-scope composition variable in the independent startup reconciliation case.
7. Resolve existing client-artifact tests through Node's actual dependency search roots. Lean managed worktrees can resolve shared installs outside the two hard-coded roots; no dependency installation/promotion was needed.
8. Whole-range review found that the source mutation seam checked only Delivery occupancy. Added explicit live-child idle proof so a GUI/inquiry turn blocks tier changes even without a current Delivery. The proof reads balanced ordinary turn boundaries and refuses unknown/open state; mutation releases its fence without applying tools. The new behavioral regression was demonstrated RED before repair and GREEN afterward.

## Verification actually run

| Check | Outcome |
| --- | --- |
| Initial shell-tier regressions on unchanged implementation | RED: absent new modules/constants/behavior, including missing restriction installation |
| Pet host/client `npm run typecheck --workspace=dsh-pet` | Passed after adaptation and idle-gate repair |
| Focused shell-tier suite | 134 passed before review repair |
| Live-child busy regression | RED before repair, GREEN afterward |
| Client/loader/mutation focused integration suite | Passed |
| Final `npm run test --workspace=dsh-pet` | 160 files passed, 3 skipped; 2859 tests passed, 43 skipped |
| Final `npm run build --workspace=dsh-pet` | Host and client build passed |
| `npm test` | 253 passed, 2 skipped, no failures |
| `npm run check:artifacts` | Passed |
| `openspec validate pet-locus-shell-tier --strict` | Passed |
| `git diff --check` | Passed |
| Scope exclusion diff (`host/collaboration`, `host/inquiry`, Worktree Session, manifest) | Empty |

Existing warnings: Vitest reports competing esbuild/oxc JSX options; tsdown reports deprecated external/noExternal options and CommonJS recommendation. These do not represent test/build failures. Skipped runtime tests are not real-host acceptance.

## Local whole-range review

Reviewed the complete current worktree delta against the target base, including new files: durable marker/tier validation; legacy safe-v1 behavior; fresh staging and cold-restore installation; restriction disposer/readback; guard scope and deliberately limited claim; management/control identity and fences; admission and dispatch-time allowlist rechecks; failure/rollback paths; UI consequences; preserving current main features.

Disposition: **pass for source port and local verification**, after correcting the live-child idle omission. This is not permission to merge/deploy and not proof of live Lark behavior.

## Live acceptance (real Lark entrance group)

Run against a **freshly created** entrance group, so the locus was created by the new code rather than carried over:

| Step | Receipt | Verdict |
| --- | --- | --- |
| `-t shell` | "工具档位已核验为 shell。当前入口转为所有者专用：仅 allowlist 成员可驱动；子会话可在本机执行命令并使用本机飞书凭据（读取与网络不受文件权限约束）。lark-cli 出站 guard 仅防误操作，不是安全边界；业务回复请用 pet_locus_finish。" | **pass** |
| bash availability | "已用 bash 执行 'echo shell-ok'，退出码 0，输出为：shell-ok" | **pass** |
| guard vs `lark-cli im +messages-send` | The command was refused before execution and returned the guard text verbatim: 「业务回复只能经 pet_locus_finish；若 finish 被拒，请在回复中说明拒绝原因，不要绕行发送。」The requested `test` body then went out through the supported finish path. | **pass** |
| `-t safe` rollback | "工具档位已核验恢复为 safe；bash 与 Skill 已收紧，入口恢复既有群成员提问规则。" | **pass** |

What this establishes and what it does not:

- A fresh locus therefore publishes `safe-v2`: a `safe-v1` entry would have been refused deterministically with `tools-legacy-v1` ("该入口仍是 safe-v1 组合…"). No explicit rebuild was needed.
- The guard text returned by the live child is **byte-identical** to `LOCUS_LARK_CLI_OUTBOUND_DENIAL`, so the server-side guard really is what refused the call.
- The disclosure is not overstated: the grant receipt states that the guard is mistake prevention and **not** a security boundary, and the child's own claim that it "did not work around it" is a self-report, not proof of impossibility — consistent with the spec, which scopes the guard to common `lark-cli` write spellings and explicitly excludes deliberate bypass.
- Not re-tested after the tier changes: restart/cold-recovery persistence of the granted tier. The earlier restart only proved the plugin loads.

## Explicit remaining gates

- Task 1.2: **owner-confirmed, not receipt-backed.** No separate history-read receipt was captured; the child reported `lark-cli` itself usable (v1.0.94) during the guard step and the owner reports the read path working. This is weaker evidence than the four receipt-backed steps above and should not be cited as equivalent.
- Task 7.2: satisfied on this target — see "Closure actions" above for the two sync runs and the idempotence result.
- Task 7.3: satisfied on this target by the table above, except the restart/cold-recovery persistence sub-item noted there.
- Task 7.4: the merge is done; published-spec merge and archive remain unchecked, and no push occurred.

## Closure actions after the port review

With explicit owner approval the reviewed port was committed, merged, and materialized:

- Commit `c907ede` on `ws/session-c6978c4f-980b-4c2a-a807-ff1ede1c9d9c` (60 files, all under `packages/dsh-pet/`, `openspec/`, `docs/`).
- Controlled merge via `scripts/ws-merge.mjs`: every gate passed, **fast-forward**, `main` == task branch == `c907ede`. No merge commit, no conflict, older Worktree Sessions retained.
- `node scripts/sync.mjs` run twice from this Worktree Session. Run 1 applied 32 changes (first materialization: built local packages, installed pinned deps, removed a deleted package). Run 2 reported `no changes — deployment already matches manifest`, so idempotence holds.
- Deployed artifact verified: `~/.dsh/profiles/web/node_modules/dsh-pet` is a real directory (copied, not symlinked) and contains the new code — `safe-v2`, the Lark CLI guard, and `toolTier` all present.
- The running Host still had the previous code in memory, so a Host restart was required before any runtime acceptance. It was performed and the new Host loads Pet normally (`ready — routes registered`, subscription connected).

### Host restart findings

The restart used a detached supervisor (`nohup bash host-restart.sh &`) meant to stop the old Host, wait for the port to free, and relaunch it. Outcome: **the supervisor completed the stop but never reached the relaunch**, and the replacement Host had to be started manually from a shell. The supervisor had already been reparented to PPID 1 before the stop, yet its log ends at `stopping old host 70969` and the process is gone. `nohup` alone is therefore not sufficient — it only ignores SIGHUP, and the process was still torn down during the old Host's shutdown. A scripted Host restart must fully detach from the old Host's process group (for example `setsid` or `launchd`), not merely use `nohup`.

Two further observations:

- The old Host **survived SIGTERM** as a leftover: it released port 3080 and held no `state.sqlite`, but stayed alive holding only `dsh.log` descriptors and required an explicit `SIGKILL`.
- `sqlite3 -readonly` on `state.sqlite` returns `database is locked` while the Host runs. That is the live Host's normal write lock, not a fault; locus rows cannot be read from outside the Host while it runs, so runtime verification must come from `dsh.log` or the management surface.

### Deployment path caveat — handle before Worktree cleanup

Running `sync.mjs` **from a Worktree Session** writes that worktree's absolute paths into the live profile: after this sync, all 11 local packages in `~/.dsh/profiles/web/package.json` `dependencies` pointed at `<worktree>/packages/*` (only the `devDependencies` entry for `dsh-worktree-session` pointed at main). Package *content* is copied, so the running Host is unaffected and the deployed code keeps working, but those recorded `file:` specs break the next `pnpm install` / `dsh plugin` once the worktree is deleted. Run `sync.mjs` once from the main checkout before removing this Worktree Session.

# T4 独立验证报告 — 第三方插件 pin 升级（width-tiers / skin-center / llm-subscriptions / better-sidebar）

- 验证者：teammate `verifier`（独立于 writer `lead`）
- 共享任务：`task-4`（owner: verifier）
- 工作目录：`/Users/prgrmrwy/opensource/ohmydsh/.worktrees/task-459f2f50d0`
- 被验证对象：`dsh.yaml`
  - 验证时 sha256 = `e0ef030da540435bee5ee9cb6bf609b5139d0fcb25702bb4b71105b249647f22`（mtime 2026-10-10 06:10:28）
  - 改动前基线副本：`.tmp-audit/verify/dsh.yaml.baseline`（sha256 `f4a036cca8accf1225eed47583069d1c60e87b7782c2916a386956f0a3642683`）
  - 验证期间复核：`manifest-after.json` 与再次 dump 的 `manifest-after-recheck.json` 逐字节相同 → 验证过程中 manifest 未被再改
- 三态口径：**通过** = 我实际运行并有输出支撑；**失败** = 实际运行后不符合预期；**未验证** = 我没有实际运行，或运行无法得出结论

> **修订说明（task-5 批次 3，2026-10-10）**：§1–§10 针对 **T4 修订** `e0ef030da540435bee5ee9cb6bf609b5139d0fcb25702bb4b71105b249647f22`。该修订随后被批次 3 取代，**当前修订**为 `a725bbdff83efeed0cc309711ee6c2edfe713e4226a5b5eef5d84c77f7650bfb`；批次 3 增量复验见 **§11**。§11 已确认批次 3 只动 `archify-dsh` 与 `jev` 两个条目，§1–§10 验证过的四条升级项及其余条目未变。

## 0. 结论速览

| # | 检查项 | 结论 | 关键证据 |
|---|--------|------|----------|
| 1 | 四条目 integrity / pin 独立复算 | **通过** | live `npm view` 与 manifest 四处逐字节一致 |
| 2 | 真实 semver + `{includePrerelease:true}` peer 复算 | **部分通过（见 3.2 注意）** | better-sidebar/llm-subscriptions 全通过；skin-center 只在 includePrerelease 下通过 |
| 3 | 改动范围（只动 4 条目） | **通过** | `git diff` = dsh.yaml 1 file / 14+14；结构 diff 仅 4 条目 20 个叶子字段；条目顺序/数量不变 |
| 4 | 隔离 DSH_HOME 幂等（连跑两次） | **通过** | run B `done — 34 change(s)`；run C `no changes`；独立内容快照 40,828 项 0 增 0 删 0 改 |
| 5 | width-tiers「恰好出现一次」 | **通过** | 全 patch 栈字面 loader 行 = 1、按 id 去重后 = 1；`patches/width-tiers-wiring.yml` 不存在 |
| 6 | better-sidebar 单实例 | **通过** | 隔离环境真实执行 `pnpm why dsh-better-sidebar` → `Found 1 version` |
| 7 | 反向核查（cost-meter / header / experimental-schedule 未动） | **通过** | 三条目结构与基线逐字节相同；隔离安装版本 1.8.4 / 0.1.0 / 0.2.0-rc.2 |
| 8 | 装后版本落地（7 个条目） | **通过** | 隔离 profile 内 7/7 版本与 pin 一致 |
| 9 | `npm run check:artifacts` | **通过** | exit 0，`tracked paths comply with repository policy` |
| 10 | `npm test`（全套） | **通过（无新增失败）** | 426 tests / 416 pass / 8 fail / 2 skipped；8 个失败全部归类为既有环境问题或既有失败（见 §5） |
| 11 | DSH 真机启动冒烟（宿主 smoke） | **未验证** | 未重启/未运行真实运行时；本轮只验证到「物化 + 组合 + 安装」层 |
| 12 | 离线（无网络）行为 | **未验证** | 未做断网实验；仅实测到 sync 会下载 |

> 一句话结论：**这四条 pin 改动本身没有发现缺陷**；四份 integrity/note pin 与 npm 上游一致，改动范围最小且精确，隔离物化幂等，装后闸口（width-tiers 唯一、better-sidebar 单实例）全部满足，反向条目未被误动。`npm test` 的 8 个失败中没有一个是本次改动引入的（证据见 §5）。

---

## 1. PHASE 1（改动落地前）基线

### 1.1 已知既有失败复现（改动前）

```bash
DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local \
  node --test --test-reporter=tap tests/repo-docs-governance.test.mjs
```

输出（改动前，`baseline-repo-docs-governance.tap`）：

```
not ok 17 - no tracked text file outside archive mentions the old notes directory
# tests 30
# pass 29
# fail 1
```

失败原因（TAP 内实际 diff）：唯一命中 `openspec/changes/dsh-memex-demote-in-context-self-cards/tasks.md:19`，与 task-4 描述的既有失败一致。

改动后再跑同一条命令，结果完全相同（`not ok 17`，30/29/1）→ 该失败**前后都存在**，与本次改动无关。

### 1.2 仓库基线

```
git status --short  →  ?? openspec/changes/upgrade-third-party-plugins/   （仅此一项未跟踪）
git stash list      →  （空）
HEAD                →  bc9755f559f8b5ba9f2fb62c8773bd19e52eca06  (ws/task-459f2f50d0)
```

### 1.3 四条目 + 反向条目改动前状态（`manifest-baseline.json`）

| id | spec | version | integrity 字段 | note 码点 |
|---|---|---|---|---|
| width-tiers | `dsh-width-tiers@1.0.6` | 1.0.6 | 无（pin 在 note 内） | 456 |
| skin-center | `@linxin666/dsh-client-ui-skin-center@0.4.4` | 0.4.4 | 无（pin 在 note 内） | 517 |
| llm-subscriptions | `dsh-plugin-subscriptions@0.9.7` | 0.9.7 | `sha512-p+rOInD3…` | 503 |
| better-sidebar | `dsh-better-sidebar@0.24.1` | 0.24.1 | 无（pin 在 note 内） | 483 |
| cost-meter（不得动） | `dsh-cost-meter@1.8.4` | 1.8.4 | 无 | 510 |
| dsh-opencode-session-header（不得动） | `dsh-opencode-session-header@0.1.0` | 0.1.0 | 无 | 467 |
| experimental-schedule（不得动） | `@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2` | 0.2.0-rc.2 | 无 | 374 |

### 1.4 隔离物化 harness 的建立（含 3 个真实障碍）

任务要求的「隔离 DSH_HOME 跑 sync」在本 worktree 不能开箱即用，实测遇到三个障碍，逐个定位并处理：

1. **npm scope 预检失败**（首次尝试，17.80s，exit 1）
   `npm scope @byted (required by package dsh-traex-bridge) has no registry configured for profile <隔离>/profiles/web`。
   来源：私有 overlay 的 `dsh-traex-bridge` 需要 `@byted` scope，而该配置只存在于生产 `~/.dsh/profiles/web/.npmrc`。
   处理：只向**隔离** profile 的 `.npmrc` 写入一行 `@byted:registry=https://bnpm.byted.org/`。该 URL 经检查**不含内嵌凭据**，我**没有**复制任何 token/凭据。
2. **XDG 路径逃出 DSH_HOME**（第二次尝试，97.86s，exit 1）
   `third-party schema target /Users/prgrmrwy/.local/share/openspec/schemas/anvil is unmanaged; refusing to overwrite`（fail-closed，未写生产路径）。
   根因：`scripts/lib/third-party-resources.mjs:481` 的 `userSchemasDir` 由 `XDG_DATA_HOME` 决定。
   处理：同时隔离 `XDG_DATA_HOME=<scratch>/xdg-data`。
3. **环境卡死**（与改动无关）
   `pnpm add @deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2`（**未改动条目**）挂起 11 分钟：进程 0% CPU、无子进程、无 socket、5 分钟内 **0 个文件被写**。判定为环境/pnpm 卡死并 kill，随后在同一隔离 home 续跑通过。

安全性核查（重要）：

- `scripts/lib/env-local.mjs:93` 的 `applyEnvLocal` 只填充 `env[name] === undefined` 的变量，且候选名单只有 `DSH_LOCAL_MANIFEST` 与 manifest 的 `enabledEnv` 名 —— **`DSH_HOME` 不在其中**，显式隔离不可能被 `.env.local` 改写；本次所有 sync 调用都显式传 `DSH_HOME=<scratch>`（ambient 为 `/Users/prgrmrwy/.dsh`，从未作为目标）。
- 除 npm/pnpm 缓存（`~/.npm`、`~/.cache`）外，sync 没有其他 home 派生写入路径；生产部署目录未被写入。

harness 结论：**sync 需要网络**（实测 pnpm 下载包 + openspec schema 归档下载），无法离线完成。

---

## 2. 改动范围核查 —— 通过

```bash
git diff --stat      →  dsh.yaml | 28 ++++++++++++++--------------   1 file changed, 14 insertions(+), 14 deletions(-)
git status --short   →   M dsh.yaml   +   ?? openspec/changes/upgrade-third-party-plugins/
```

结构 diff（`dump-manifest.mjs`，改动前 vs 改动后，共 32 条目）：

- 变化的叶子字段**恰好 20 个**，只落在 4 个条目上：`spec` / `version` / `integrity`（仅 llm-subscriptions）/ `noteSha512` / `noteCodePoints` / `noteBytes`；
- `entryCount` 32 → 32，**条目顺序完全一致**（`order identical: true`），`dshVersion` 未变（0.2.0-rc.2）；
- note 码点长度：width-tiers 456→**531**、skin-center 517→**575**、llm-subscriptions 503→**589**、better-sidebar 483→**579**（与 Lead 自报一致，均 ≤600）；
- 反向三条目（cost-meter / dsh-opencode-session-header / experimental-schedule）**整条目 JSON 与基线逐字节相同**。

---

## 3. pin / integrity / peer 独立复算

### 3.1 integrity —— 通过

不采信 Lead 给的值，直接向 live registry 复算：`npm view <name>@<version> dist.integrity --json`（脚本 `.tmp-audit/verify/check-integrity-peers.mjs`，结果 `integrity-peers.json`）。

| id | 声明位置 | manifest 声明值 vs live registry |
|---|---|---|
| width-tiers 1.0.7 | note 内 `pin 校验` | 一致（`sha512-3cGoklw3…`） |
| skin-center 0.4.5 | note 内 `pin 校验` | 一致（`sha512-+hGFYDAk…`） |
| llm-subscriptions 0.9.9 | `integrity:` 字段 | 一致（`sha512-eXdAPyCO…`） |
| better-sidebar 0.25.0 | note 内 `pin 校验` | 一致（`sha512-5dro5VDp…`） |

附加：`llm-subscriptions` 的 provenance 注释 `gitHead 9930c5ee5e3fa239db9031f47a0f6f30f7ffc443` 与 live registry `gitHead` 完全一致。`spec` 版本与 `version:` 字段四条目均自洽。

### 3.2 peer 复算 —— 通过（含一处必须说明的语义注意）

使用仓库真实 `semver@7.8.5`（`node_modules/semver`），对 `dshVersion = 0.2.0-rc.2` 复算：

| id | `@deepseek-ai/dsh*` peer | 区间 | `{includePrerelease:true}` | 纯 `satisfies` |
|---|---|---|---|---|
| width-tiers 1.0.7 | 未声明任何 `@deepseek-ai/dsh*` peer | — | 无约束（无可复算项） | — |
| skin-center 0.4.5 | `@deepseek-ai/dsh` | `>=0.1.7-rc.1` | **true** | **false** |
| llm-subscriptions 0.9.9 | dsh-llm / dsh-web / dsh-tools / dsh-attachment / dsh-home-paths | `^0.1.1-rc.2 \|\| … \|\| 0.2.0-rc.2` | true（5/5） | true（5/5） |
| better-sidebar 0.25.0 | 14 个官方包 | `^0.2.0-rc.2` | true（14/14） | true（14/14） |

**注意（不是失败，是需要 Lead 判断的口径问题）**：skin-center 的 `>=0.1.7-rc.1` 在纯 `semver.satisfies` 下为 **false**（semver 的「pre-release 仅对同 major.minor.patch 的 comparator 放行」规则所致），只有 `includePrerelease:true` 才为 true；仓库自带的 `scripts/lib/plugin-updates.mjs satisfies()` 对 `>=` 形式返回 `null`（不支持该区间写法 → 会落到 needs-review 而非 pass）。四条目中只有 skin-center 有这种口径依赖，其余条目两种口径都通过。

---

## 4. 隔离物化：幂等 + 装后闸口

隔离参数（每次 sync 都显式传入）：

```bash
DSH_HOME=<scratch>/iso-home-2  XDG_DATA_HOME=<scratch>/iso-home-2/xdg-data  node scripts/sync.mjs
# 另：<scratch>/iso-home-2/profiles/web/.npmrc 预置 @byted:registry=https://bnpm.byted.org/
```

### 4.1 幂等 —— 通过

| 运行 | 结果 | 耗时 | sync 自报 |
|---|---|---|---|
| run B（补齐安装，含 openspec schema 下载） | exit 0 | `real 33.70` | `[sync] done — 34 change(s) applied` |
| run C（紧接着第二次） | exit 0 | `real 2.42` | `[sync] no changes — deployment already matches manifest` |

不止采信 sync 自报：对整棵隔离 home 做独立内容快照（`snapshot.mjs`：路径 → sha256/size/symlink 目标，40,828 项），run B 后与 run C 后对比：

```
entries B: 40828 | entries C: 40828
added: 0   removed: 0   content changed: 0
IDEMPOTENT: byte-identical tree
```

### 4.2 width-tiers「恰好出现一次」—— 通过

不依赖 `plugin-list.mjs` 的去重逻辑（它会按 name 去重，掩盖「两条 id-less insert」缺陷），而是独立统计**整个 patch 栈的字面 loader 行**（`.tmp-audit/verify/count-loader-rows.mjs`，结果 `loader-rows.json`）：

```
bundles: 24 | literal rows: 31 | effective rows: 29
patch parse errors: 0 | duplicates collapsed by id: 2
dsh-width-tiers: literalRowsInPatchStack = 1, effectiveRowsAfterIdDedup = 1
  source: <DSH_HOME>/profiles/web/node_modules/dsh-width-tiers/cordis.patch.yml   id = dsh-width-tiers
```

- 唯一那行来自**包自带 bundle patch**，且**带显式 id**（不会重复展开）；
- profile 层 `profiles/web/cordis.patch.yml` 与 home 层 `cordis.patch.yml` 中**没有** width-tiers 行；
- 仓库 `patches/` 目录只有 `README.md` / `README.zh.md` / `connection-webserver.yml`，**`width-tiers-wiring.yml` 不存在**（Historical 双插行缺陷的载体已移除）；
- 交叉验证：`DSH_HOME=<隔离> node scripts/plugin-list.mjs --names` → 28 行，其中 `dsh-width-tiers` 恰好 1 次。

### 4.3 better-sidebar 单实例 —— 通过（真实执行，非未验证）

在隔离安装出的 profile 目录里真实执行：

```
$ pnpm why dsh-better-sidebar          # cwd = <隔离>/profiles/web
dsh-better-sidebar@0.25.0
├── dsh-profile-web (dependencies)
└─┬ dsh-session-links
  └── dsh-profile-web (dependencies)

Found 1 version of dsh-better-sidebar

$ pnpm why dsh-width-tiers
dsh-width-tiers@1.0.7
└── dsh-profile-web (dependencies)

Found 1 version of dsh-width-tiers
```

（pnpm v11.9.0 在本机 PATH 上可用，故任务中「不可行则记未验证」的条件不成立，本条按**通过**记。）

### 4.4 装后版本落地 —— 通过（`evidence/installed-versions.json`）

隔离 profile 内实际安装版本：width-tiers **1.0.7**、better-sidebar **0.25.0**、llm-subscriptions **0.9.9**、skin-center **0.4.5**、cost-meter **1.8.4**、dsh-opencode-session-header **0.1.0**、experimental-schedule **0.2.0-rc.2**（7/7 与 pin 一致；profile `dependencies` 也写成精确 pin）。

openspec 第三方 schema 也物化进隔离区并留下指纹：`evidence/anvil-schema-fingerprint.txt`（files=9, tree-sha256=`6f9bb82c…`）。

---

## 5. 根校验：`npm test` / `check:artifacts`

### 5.1 `npm run check:artifacts` —— 通过

```
> node scripts/check-tracked-artifacts.mjs
[artifacts] tracked paths comply with repository policy
exit 0
```

### 5.2 `npm test` —— 无新增失败（8 个失败全部为既有环境问题或既有失败）

`npm run test:tap`（clean tree）结果：

```
# tests 426   # pass 416   # fail 8   # skipped 2   # duration_ms 34947
not ok 19  sync_records_authoritative_checkout_and_second_sync_is_noop
not ok 20  approved_upgrade_persists_across_sync_without_pin_mismatch_and_keeps_old_generation
not ok 21  rollback_rewrites_source_and_survives_sync_without_mismatch
not ok 22  blocked_or_failed_upgrade_keeps_hashes_and_active_id
not ok 23  kill_after_cas_reports_recovery_in_block_and_old_generation_serves
not ok 24  user_edit_after_cas_returns_recovery_required_untouched
not ok 199 no tracked text file outside archive mentions the old notes directory      ← 已知既有失败
not ok 261 dsh_openspec_clean_sync_then_noop_with_notice
```

分类与证据：

**(a) #19–24、#261（7 个）—— 环境（lean worktree 缺 `tsc`），与 dsh.yaml 无关**

- 报错均在 fixture 的 `setup()`：`npm error Lifecycle script 'build' failed … packages/dsh-openspec … command sh -c tsc -p tsconfig.json`；同步器日志：`local package dsh-openspec: npm run build --workspace dsh-openspec (in <fixture repo>) failed before deployment`。
- 这些用例**不读根 `dsh.yaml` 的四个条目**：`dsh-openspec-upgrade.test.mjs:16` 与 `sync-dsh-openspec.test.mjs:25/45` 都用**合成的 fixture manifest**（`dshVersion: 0.1.5-rc.2` + 仅 dsh-openspec），`overlay-fixture.mjs:95` 把该合成 manifest 写成 fixture 仓库自己的 `dsh.yaml`（#261 只是从根 manifest 里截 `dsh-openspec` 段落断言 `source: local`，不触碰四条升级项）。
- 根因定位（可复现实验，与 dsh.yaml 完全无关）：
  - 本 lean worktree 的 `node_modules/.bin` 只有 6 个 bin（`js-yaml rolldown semver tldts unrun yaml`），**没有 `tsc`**；worktree 内**根本没有 `node_modules/typescript`**；主 checkout 才有（`/Users/prgrmrwy/opensource/ohmydsh/node_modules/.bin/tsc` → `../typescript/bin/tsc`）。
  - 在临时目录复刻 fixture 布局（`scripts/` + 真 `package.json`/`package-lock.json` + `packages/dsh-openspec` + `node_modules` 符号链接），跑 `npm run build --workspace dsh-openspec`：node_modules 指向 **lean worktree** → `sh: tsc: command not found`（npm code 127）；同一实验把 node_modules 指向**主 checkout 的完整 node_modules** → **exit 0，`lib/` 正常产出**。
  - 时间戳旁证：`node_modules`（05:41:28）早于 `dsh.yaml` 被改（06:10:28）；改 pin 不可能改变 worktree 的依赖安装状态。
- 因此这 7 个失败是**本 worktree 的依赖模式（lean）在 temp-dir fixture 中无法解析 `tsc`** 导致的既有环境失败。

**(b) #199（1 个）—— 已知既有失败**：改动前基线就是 `not ok 17`（同文件同断言，30/29/1），改动后复现完全相同。

### 5.3 我自己的一个验证污染，已修正并留档

第一次跑全员套件时共 10 个失败，多出的 `#213 root README pair is tracked…` 与 `#224 plugin index covers every enabled customization…` 是**我自己造成的**：`tests/repo-facade.test.mjs:54` 的 `facadeFiles()` 用 `git ls-files --cached --others --exclude-standard` + 默认 1 MiB `maxBuffer`，而我的隔离 scratch 目录贡献了 **19,052** 个未跟踪文件 → `spawnSync` 报 `ENOBUFS`（`status: null`，stdout 被截在 1,114,112 字节）。

处理：把 `.tmp-audit/` 加入本地 `.git/info/exclude`（**未改动任何 tracked 文件**），未跟踪条数 19,053 → 1，随后重跑全套 → 失败数 10 → **8**，#213/#224 自动消失。这一条记录在此，避免把「我自己造成的失败」误记成改动的回归。

---

## 6. 反向核查 —— 通过

| 条目 | 要求 | 实测 | 结论 |
|---|---|---|---|
| cost-meter | 仍为 1.8.4 | 条目 JSON 与基线逐字节相同；隔离安装 `1.8.4` | 通过 |
| dsh-opencode-session-header | 未变 | 条目 JSON 逐字节相同；隔离安装 `0.1.0` | 通过 |
| experimental-schedule | 仍为 0.2.0-rc.2（不得降到 rc.1） | 条目 JSON 逐字节相同；隔离安装 `0.2.0-rc.2`（registry `latest` 是 rc.1，但 manifest/pin/安装均为 rc.2，未被降级） | 通过 |

另：`npm view @deepseek-ai/dsh-experimental-schedule-bundle` 的 `dist-tags.latest = 0.2.0-rc.1`，而 manifest 精确 pin `0.2.0-rc.2`（`next` tag）——**这是既有设计，本次未被改动**，同步过程也未出现任何降级。

---

## 7. 未验证项（明确列出，未计入通过）

1. **DSH 宿主启动冒烟（host smoke）未做**：我没有重启 DSH、没有运行 `dsh build` 到生产 home、没有在真实运行时里确认这四个新版本插件能正常加载（尤其 better-sidebar 0.25.0 的 `registerTab`/终端依赖变化、skin-center 0.4.5 把 Steam/WE 扫描移出后设置页行为）。本轮验证覆盖到「物化 + 组合 + 安装 + 版本落地」层，不等于运行时可用。
2. **离线行为未验证**：只实测 sync 需要网络（下载包与 schema 归档），没有做断网实验来验证失败模式是否 fail-closed。
3. **「7 个 openspec 失败在完整（非 lean）checkout 下会通过」是推断**：我用 fixture 构建实验隔离出了唯一变量（`tsc` 可用性 → exit 0），但没有在完整 checkout 里跑过整套 `npm test`，因此不宣称「全部 426 用例在完整 checkout 下通过」。
4. **`pnpm why` 的实例唯一性只在隔离 profile 内验证**：没有在生产 `~/.dsh` 上执行（避免触碰现役部署）。

---

## 8. 我（验证者）对仓库做的本地改动（非 tracked）

1. `/Users/prgrmrwy/opensource/ohmydsh/.git/info/exclude` 追加两行（本地、未跟踪、可逆）：

   ```
   # verifier scratch (task-4); local-only, not tracked
   .tmp-audit/
   ```

   理由：若不忽略，我的 scratch 会让 `repo-facade` 的两个用例因 `git ls-files` 超 `maxBuffer` 而假失败（见 §5.3）。**回滚**：删除这两行即可。
2. 所有验证产物都在 `.tmp-audit/verify/` 下；1.2 GB 的两个隔离 home 在提取紧凑证据（`evidence/`）后已删除，避免把可重建的物化产物长期留在 worktree。`evidence/` 内保留了 profile `package.json`、profile patch 层、两个 bundle patch、安装版本清单与 schema 指纹，足以复核本报告的关键断言。

`.tmp-audit/` 之外，我没有修改任何 tracked 文件；`dsh.yaml` 始终只由 Lead 写入。

---

## 9. 复现命令（关键几条）

```bash
# pin / integrity 独立复算（live registry）
node .tmp-audit/verify/check-integrity-peers.mjs dsh.yaml

# 结构 diff（基线 vs 当前）
node .tmp-audit/verify/dump-manifest.mjs .tmp-audit/verify/dsh.yaml.baseline /tmp/base.json
node .tmp-audit/verify/dump-manifest.mjs dsh.yaml /tmp/after.json

# 隔离 sync（注意：必须同时隔离 XDG_DATA_HOME；profile .npmrc 需预置 @byted scope）
ISO=<scratch>/iso
mkdir -p "$ISO/profiles/web" && printf '@byted:registry=https://bnpm.byted.org/\n' > "$ISO/profiles/web/.npmrc"
DSH_HOME="$ISO" XDG_DATA_HOME="$ISO/xdg-data" node scripts/sync.mjs   # run 1
DSH_HOME="$ISO" XDG_DATA_HOME="$ISO/xdg-data" node scripts/sync.mjs   # run 2 → 期望 "no changes"

# 装后闸口
DSH_HOME="$ISO" node scripts/plugin-list.mjs --names | tr ',' '\n' | grep -c '^ *dsh-width-tiers$'   # 期望 1
node .tmp-audit/verify/count-loader-rows.mjs "$ISO" web
( cd "$ISO/profiles/web" && pnpm why dsh-better-sidebar )    # 期望 "Found 1 version"

# 根校验
npm run check:artifacts
npm run test:tap        # 期望 426/416/8（含 1 个已知既有失败 + 7 个 lean-worktree tsc 环境失败）
```

## 10. 验证者声明

- 本报告每一条「通过」都有本文中列出的实际命令输出支撑；没有把未执行的项目写成通过。
- 我主动做了伪证尝试：独立复算 pin、用结构 diff 反查改动范围、用字面 loader 行统计绕开 `plugin-list` 的去重、用独立快照 diff 复核 sync 自报的幂等、用「完整 node_modules 对照实验」隔离环境失败、并在发现 `npm test` 出现 10 个失败时先怀疑改动、最终定位其中 2 个是**我自己的验证污染**。
- 我没有修改 `dsh.yaml` 或任何 tracked 文件。

---

# §11 批次 3 增量复验（task-5，archify-dsh + jev）

- 被验证对象（当前修订）：`dsh.yaml` sha256 **`a725bbdff83efeed0cc309711ee6c2edfe713e4226a5b5eef5d84c77f7650bfb`**（mtime 2026-10-10 06:35:56）
- 上一轮（T4）修订 `e0ef030da540435bee5ee9cb6bf609b5139d0fcb25702bb4b71105b249647f22` 已失效，不再代表仓库现状
- 验证结束时复核：hash 未变（我未编辑该文件）

## 11.0 三态结论

| 检查项 | 结论 |
|---|---|
| 增量范围：只多 archify-dsh + jev | **通过** |
| 先前的 4 条升级项 + 反向条目逐项未变 | **通过** |
| archify-dsh@1.0.0 / jev-mcp@0.14.1 integrity 独立复算 | **通过**（11/11 声明 pin 与 live registry 一致） |
| jev 条目结构合法性（字段白名单、无 `note`） | **通过**（含负向对照：注入 `note` 被拒） |
| 隔离 sync 连跑两次 = 幂等 | **通过**（第二次字节级无变化） |
| 装后版本：archify 1.0.0 / jev-mcp 0.14.1 | **通过** |
| `tests/manifest-notes|manifest-version-drift|third-party-resources` 等 5 文件 | **通过**（37/37） |
| 全套 `npm test` 无新增失败 | **通过**（与 T4 完全相同的 8 个失败） |
| `npm run check:artifacts` | **通过**（exit 0） |
| DSH 宿主启动冒烟（含 archify 1.0.0 的 Chrome browser-check / 版本查询） | **未验证** |
| 离线行为 | **未验证** |

## 11.1 增量范围与「其余未变」—— 通过

```bash
git diff --stat        →  dsh.yaml | 40 ++++++-------   1 file changed, 20 insertions(+), 20 deletions(-)
```

累计 20/20 = 批次 2 的 14/14（逐字未变）+ 批次 3 的 6/6：`archify-dsh`（spec、version、note 3 行）、`jev`（spec、version、integrity 3 行）。

结构 diff（`.tmp-audit/verify/dump-manifest-2.mjs`，T4 修订 dump vs 当前修订）：

```
customizationCount: 32 -> 32 | order identical: true
changed entries: archify-dsh
  spec             @tt-a1i/archify-dsh@0.1.0 -> @tt-a1i/archify-dsh@1.0.0
  version          0.1.0 -> 1.0.0
  noteCodePoints   169 -> 495        （限值 600，manifest-notes 测试通过）
  noteBytes        267 -> 735
  noteSha512       [] -> ["sha512-ae5L+SyZngy3EzYnWHHfccAYJCZh5e9MTkEBh7mrwTMfpwpFtkIhiOg2vI5xnluCS8CSb+Ne1hi1kOWRQQtGBQ=="]
added entries: (none)
```

除 `archify-dsh` 外，**32 条 customizations 的 spec/version/integrity/note 长度/note pin 指纹全部与 T4 dump 逐一相等**，包括 width-tiers 1.0.7、skin-center 0.4.5、llm-subscriptions 0.9.9、better-sidebar 0.25.0、cost-meter 1.8.4、dsh-opencode-session-header 0.1.0、experimental-schedule 0.2.0-rc.2、dsh-cockpit-bridge 0.6.4。

thirdPartyResources（当前）：`spec-superflow@2.0.1`（+ provider `@deepseek-ai/dsh-skill-filesystem@0.2.0-rc.2`）与 `anvil` schema 未变；`jev` 仅 spec/version/integrity 变化（`git diff` 中该块只有这 3 行）。

> 说明（诚实边界）：T4 dump 记录的是**结构性指纹**（spec/version/integrity/note 码点与字节长度/note 内 sha512），不是 note 散文的全文副本 —— 我未保留 T4 修订的原始字节，因此未变条目的 note **散文**只由「长度 + 内嵌 sha512 + git diff 无对应 hunk」三重证据覆盖，而非全文逐字节 diff。

## 11.2 integrity 独立复算 —— 通过（11/11）

不采信 Lead 的值，直接 `npm view <spec> dist.integrity`（`check-batch3-integrity.mjs` → `batch3-integrity.json`）：

| 声明项 | 声明值来源 | live registry |
|---|---|---|
| `@tt-a1i/archify-dsh@1.0.0` | note 内 `pin 校验` | 一致 |
| `@jkudish/jev-mcp@0.14.1` | `integrity` 字段 | 一致 |
| `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2`（jev bridge） | `bridge.integrity` | 一致 |
| 批次 2 四条（4/4） | note / integrity | 一致 |
| 反向 cost-meter、experimental-schedule、spec-superflow + provider | note / integrity | 一致 |
| `dsh-opencode-session-header@0.1.0` | **无声明 pin**（spec-only） | N/A —— 非 mismatch（条目本身与 T4 逐字段相同） |

peer（`semver` + `{includePrerelease:true}`，`dshVersion=0.2.0-rc.2`）：

- `archify-dsh@1.0.0`：**未声明任何 peerDependencies**（无 DSH 兼容性约束）；
- `jev-mcp@0.14.1`：无 peerDependencies；其 bridge `dsh-mcp-client@0.2.0-rc.2` 的 8 个精确版本 peer（dsh-llm/scope/tools/timeout/attachment/subprocess/mcp-resources/system-prompt）全部 = `0.2.0-rc.2` → 两种口径都通过；
- 其余条目结论与 §3.2 相同（skin-center 仍是唯一「仅 includePrerelease 通过」的条目）。

## 11.3 jev 条目结构合法性 —— 通过（含负向对照）

直接调用 `scripts/lib/third-party-resources.mjs` 导出的 `validateThirdPartyResources`（`check-resource-whitelist.mjs`）：

```
real manifest thirdPartyResources          → 接受（spec-superflow / jev / anvil）
negative control: jev + note               → 抛出 "thirdPartyResources[1] (jev): unknown field note"
negative control: jev + bogusField         → 抛出 "thirdPartyResources[1] (jev): unknown field bogusField"
jev 实际字段 = [bridge, credentialEnv, enabled, id, integrity, reconnect, serverName, spec, toolCallTimeoutMs, type, version]
             = FIELDS['npm-mcp-server'] 精确集合；hasNote = false
```

负向对照证明「无 `note`」不是空约束：白名单确实会拒绝 `note`。

## 11.4 隔离物化幂等（连跑两次）—— 通过

harness 沿用 T4 的两个前提：隔离 profile 的 `.npmrc` 预置 `@byted:registry=https://bnpm.byted.org/`（无凭据）+ 同时隔离 `XDG_DATA_HOME`；每次都显式传 `DSH_HOME=<scratch>`。

| 运行 | 结果 | 耗时 | 自报 |
|---|---|---|---|
| run A（全新 home） | **环境卡死被 watchdog/kill 终止** | — | 停在 `pnpm add @deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.2`（**未改动条目**） |
| run B（续跑） | exit 0 | `real 30.65` | `[sync] done — 34 change(s) applied` |
| run C（紧接着第二次） | exit 0 | `real 2.62` | `[sync] no changes — deployment already matches manifest` |

- 独立的整树内容快照 diff：`added 0 / removed 0 / content changed 0`（34,092 项）→ **byte-identical**。
- 卡死是**可复现的环境问题**（T4 起第 3 次，均在同一 `experimental-schedule` 步骤）：挂起期间 0 个文件被写、无 socket、`sample` 显示主线程空转在 `uv__io_poll`/`kevent`、worker 线程 `uv_cond_wait` 停泊（即等一个永不到来的事件，不是文件锁竞争）；kill 后续跑即通过。与本批次两个条目无关。
- run B 日志确认：`install remote package @jkudish/jev-mcp (@jkudish/jev-mcp@0.14.1)`、`generate managed launcher jev`、`install third-party schema anvil`、`copy skill jev-workflow-router`；无 ERROR。

## 11.5 装后版本与产物 —— 通过

隔离 profile 内实际安装（`evidence/installed-versions.json`）：

```
@tt-a1i/archify-dsh 1.0.0 ✔   @jkudish/jev-mcp 0.14.1 ✔
dsh-width-tiers 1.0.7         dsh-better-sidebar 0.25.0
dsh-plugin-subscriptions 0.9.9  @linxin666/dsh-client-ui-skin-center 0.4.5
dsh-cost-meter 1.8.4          dsh-opencode-session-header 0.1.0
@deepseek-ai/dsh-experimental-schedule-bundle 0.2.0-rc.2
```

- profile `dependencies` 为精确 pin：`@tt-a1i/archify-dsh: 1.0.0`、`@jkudish/jev-mcp: 0.14.1`；
- jev 托管启动器 `<DSH_HOME>/managed-assets/jev-launcher.mjs` 已生成，指向 `profiles/web/node_modules/@jkudish/jev-mcp/dist/index.js`，缺 `TYPESAFE_API_KEY` 时 `exit 78`（fail-closed）；
- archify 的 skill 不经 `$DSH_HOME/skills/` 物化（该目录下无 `archify`），而是由包自带 `cordis.patch.yml` 注册 `@deepseek-ai/dsh-skill-filesystem`（`providerName: archify-plugin`、`bundledSkillDir` 由安装身份解析到包内 `skills/`）—— 属预期机制，包内 `skills/archify/` 完整存在；
- 组合面未变：24 bundles / 31 字面 loader 行 / 29 有效行 / 0 解析错误 / 2 个按 id 折叠，与 T4 相同；`dsh-width-tiers` 与 `dsh-better-sidebar` 各仍然恰好 1 行；
- anvil schema 指纹与 T4 完全一致（`files=9`，`tree-sha256=6f9bb82c575e1b640f5b8556e322f62f52b76f40d52eaf7fa5b85f77d49a0e76`）。

## 11.6 测试与检查 —— 通过

- 指定 5 个测试文件（manifest-notes / manifest-version-drift / third-party-resources / plugin-update-rewrite / sync-local-manifest-overlay）：**37 tests / 37 pass / 0 fail**；
- 全套 `npm run test:tap`：**426 tests / 416 pass / 8 fail / 2 skipped**，失败集合与 T4 修订**逐一相同**（#19–24、#199、#261）→ 无新增失败；
- `npm run check:artifacts` → exit 0。

## 11.7 观察项（非失败，供 Lead / 其它 reviewer 判断）

1. `dsh-opencode-session-header` 是 spec-only pin（无 `integrity` 字段、note 内无 sha512）—— 既有状态，未变；`integrity` 缺失使该条目无法做字节级校验，只能锁版本号。
2. `@jkudish/jev-mcp@0.14.1` 的 5 个**传递依赖**是浮动 caret（`zod ^4.6.5`、`@typesafe-ai/sdk ^0.6.0`、`@jkudish/jev-agent-tools ^0.2.0`、`@modelcontextprotocol/node ^2.1.1`、`@modelcontextprotocol/server ^2.3.1`）；manifest 只冻结直接 spec+integrity（+bridge），传递依赖由安装时解析 —— 属既有供应面模型，不是本次改动引入的缺陷。该包声明 `prepare: npm run build`，但 registry tarball 安装不会执行 `prepare`（已确认 sync 日志无相关构建输出）。
3. `@tt-a1i/archify-dsh@1.0.0` 无 peerDependencies/依赖/安装脚本；包内 `release.json` 为 `{sourceCommit: 7158026e852f3aa6578c741e673b46d7878c92c1, skillVersion: 3.0.1, dshVersion: 0.1.2-rc.1}`（元数据，非约束）。

## 11.8 仍未验证项（未计入通过）

- **DSH 宿主启动冒烟**：未重启/未跑真实运行时。archify 1.0.0 的两个新行为（匿名版本查询、强制 `--headless=new` Chrome browser-check，缺 Chrome 时 `finalize` exit 2）以及 jev 0.14.1 的真实 MCP 会话，都未在活体 Host 上验证；archify 行为审查属 `archify-analyst` 的范围，我只验证到「安装的是 1.0.0 且 integrity/note 一致」。
- **离线行为**：仍未做断网实验。
- `archify-dsh` 的 note 散文所述信任面（版本查询域名、4s 上限、`ARCHIFY_UPDATE_CHECK_DISABLED=1` 开关等）我**未**逐条复核上游实现 —— 我只复核了其中 `pin 校验` 的 sha512。

## 11.9 复现命令（批次 3）

```bash
node .tmp-audit/verify/dump-manifest-2.mjs dsh.yaml /tmp/batch3.json      # 结构（含 thirdPartyResources）
node .tmp-audit/verify/check-batch3-integrity.mjs                        # 11/11 pin 复算 + peer
node .tmp-audit/verify/check-resource-whitelist.mjs                      # 白名单 + 负向对照
bash .tmp-audit/verify/p3-sync-pair.sh                                  # 隔离 sync 两次 + 快照 diff（含 watchdog）
DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local \
  node --test tests/manifest-notes.test.mjs tests/manifest-version-drift.test.mjs \
    tests/third-party-resources.test.mjs tests/plugin-update-rewrite.test.mjs \
    tests/sync-local-manifest-overlay.test.mjs                          # 37/37
npm run test:tap                                                        # 426/416/8/2（8 个均为既有/环境失败）
```


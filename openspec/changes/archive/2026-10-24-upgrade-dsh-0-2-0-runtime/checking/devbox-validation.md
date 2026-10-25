> Migrated from docs/notes/upgrade-dsh-0-2-0-devbox-validation.md.
# DSH 0.2.0-rc.2 devbox 验证：当前状态 NO-GO

## 身份范围

- 基线/原候选及隔离日志：devbox `<devbox>`、`~/.cache/dsh-acceptance/upgrade-0.2.0-c48b507/`、Node 24。候选修复序列由 `c48b507` 经 `20a498a`（profile 空序列与规范修复）推进，随后存在 `bab1a536`（验收记录更新）；历史完整报告见 `checking/devbox-profile-fix.md` 与 `checking/devbox-runtime-continuation.md`。
- 现有 Pet-enabled devbox 验收 checkout 是 **`83c69cf796dc59d24587becf1d3ba45f29336962`**，它是修复提交 `20a498a` 与记录提交 `bab1a536` 的后继，已经包含 profile 修复。与本地 `131d626` 的净差异仅为 OpenSpec 文档，无代码/manifest/依赖差异；二者代码等价。此前声称 `83c69cf` 未包含修复或不具备该源码身份的表述错误，现予纠正。代码等价不自动证明完整生产组合验收。
- 远端联网 SSH 使用 `zsh -lic '<proxy-helper>; …'`。用户恢复实施授权后，本轮已移植源码并跑 devbox 测试，非只读轮次；未运行 devbox 3080 的 build/restart，未 push 或发布源码。

## 已确立事实

- 先前 `c48b507` 的 clean sync ×2 虽然第二次报 `no changes`，但官方 `--dump-config` 失败：官方空 profile 的 standalone `[]` 被保留为第二个 YAML 根。修复 commit `20a498a` 的历史证据记录了精确空序列修复、注释/CRLF 保留、写前 loader-dialect 校验，以及新 profile sync ×2、dump 成功；最终根测试 293 total / 291 pass / 2 skipped、`check:artifacts` 和 `openspec validate --strict` 通过。该项证明 F1/F2 修复，不代表后续全插件组合通过。
- 已检查的 Pet-enabled 目标依赖 checkout `83c69cf`：Pet 全量 suite 为 **159 files passed、3 skipped；2813 passed、43 skipped**；在该 checkout 中 `npm run typecheck`（host/client）通过。这些日志证明的是包级测试，不是完整 Host 的 Pet live/cold GUI/Feishu 验收，也不是对当前候选 commit `131d626` 的测试结果。
- 同 checkout 实际 launcher manifest 是 DSH `0.2.0-rc.2` + subagent `0.2.0-rc.2-locus-settlement-notice.2`；upstream base `639ed015397290b3745d163aafe02ffee4aa3f84`，compat patch SHA `86310610709d80d540dd97b1b7fb1fbc4012a3ef1f5eadc12ba590f7905005fa`。silent settlement、idle creation、independent child preset、exact Session access、host-authored delivery 等 marker 确实存在；marker 不证明 production Pet composition 或冷启动行为。
- 一次近期候选启动已明确指定独立 `DSH_HOME`、HOME 和 XDG，使用 39521；之后按精确进程身份发送 SIGTERM。复核无 39521 listener/process；devbox 生产 DSH PID `2004366` 未变。没有模型请求或真实 Feishu 操作。
- Cockpit 同源真实 server/iframe 集成另记于 `deliverables/cockpit-upgrade-acceptance-status.md` 和 `deliverables/cockpit-real-integration-review.md`，与 DSH 完整候选门禁分开。
- 当前本地隔离候选 HEAD 是 `131d626e2213fe19121daa2aff7e549529763877`，包含 DSH sync 修复、session-links DSH 0.2 `message.isError` 兼容，并撤销越出既定窄范围的 session-links 新 Config 编辑面；工作树 clean。静态检查确认：sync 解析区外内容、保留官方空序列注释、以目标 loader 方言校验完整单一序列后才替换 patch/备份；回归源码覆盖两版本、注释/CRLF、重复 sync、seed 和 fail-closed。但这不是本轮运行期验证。
- 上一轮错误地把 Harness 的 `danger-full-access` 当成不能按既定 devbox 方案测试的理由；该自行添加的 OS/container 沙箱前置条件已撤销。用户再次明确要求沿用主干 + devbox 验证方案。本轮实际使用独立 HOME/DSH_HOME/TMPDIR/XDG 跑已有测试；不启动生产 Host，不触碰生产配置、模型或 Feishu。验收与生产数据分开，不再开展额外沙箱工程。

## 用户方案恢复后的实际进展

- devbox 主干精确 HEAD `59ad0e5bcec27004af0cd35a7e03721c61f9195f`，工作树 clean，manifest 仍是 DSH `0.1.5-rc.2`。主干新增/调整了 Pet 安全修复、memex 和 session-links 等，不能以旧升级候选整树替换主干。
- 已在 devbox 的 `83c69cf` 使用 Node `v24.12.0` 复跑：根测试 **293 total / 291 pass / 2 skip / 0 fail**，artifact check PASS；session-links **5 文件 / 59 测试 PASS**，host/client typecheck PASS。运行前后 source clean，日志在 `resume-regression-GZQe2lGO/`。这验证了与 `131d626` 等价的代码，不等同整个当前主干迁移通过。
- 在当前主干的未合入验收副本上仅迁移 session-links 必需的 `message.isError` 判断和现有 V4 回归，未加入设置编辑功能。devbox 目标 0.2 依赖下 **5 文件 / 55 测试 PASS**、host/client typecheck PASS，日志在 `main-session-links-Kv7efSjL/`。计数不同源于主干既有代码/测试与旧升级分支不同，不将其伪装成同一套测试。
- 全量 migration patch 对当前主干的预检暴露真实冲突（manifest/lock、memex、Pet compat、sync 等），未强行覆盖。现已在主干验收副本适配无冲突的 subscriptions shim、worktree handoff/lifecycle/archive 路径：devbox **shim 28/28 PASS**，**worktree 定向 4 文件 / 41 测试 PASS**、host/client typecheck PASS；日志在 `main-easy-020-onuAanQg/`。未将定向测试等同 worktree 全量通过；没有提交、合并、push 或改生产 pin。

- 当前主干会话选择适配也已完成第一轮 devbox 验证：session-title-copy **23/23**、sidebar-session-provider-icon **28/28**、home-network-model-guard **73/73**，三个包 host/client typecheck 均 PASS；日志在 `main-selection-020-jJaQqRBV/`。这证明单元/API 类型兼容，不是 GUI 实际切换/剪贴板/guard 预热验收。
- 上述主干移植仍是未提交的源码 patch，未更改版本 peer 或主干 manifest、未重建正式依赖锁，因此不能通过完整 loader 门禁。测试复用了既有 0.2 验收依赖，非 clean install 证明。

## 主干基线的进一步纠正与最终移植

- 提交时间与谱系确认：devbox `59ad0e5b` 为 **9 月 25 日旧主干**，本机主干 `b6e5c47415c847387f8c93dbf07fbdafeb253fb2` 为 **10 月 5 日较新主干**。上文旧快照上的测试是辅助兼容证据，不是最终升级基线。此前以提交 log 头部印象判断 devbox 主干较新是错误的。
- 对较新主干 `b6e5c474` 提取原升级的净 migration（`c9e927e5..131d626`），三方预检和应用均无冲突；保留 Pet shell-tier、Worktree caller-bound inquiry、memex workspace/org 和 bridge 0.5.2 等主干能力。只在托管目录中的 `.validation/current-main-upgrade` 应用 patch，未修改本机主 checkout。
- **78 文件 migration patch**（含 manifest/lock、memex、Pet、sync、测试）已经送至 devbox。独立 `current-main-build-9fdFNcBd/repo` 的 clean `npm ci --ignore-scripts`、全部 workspace build、artifact check、`npm ls --all` PASS；完成构建后根测试 **291 pass / 2 skip / 0 fail**，全部 11 local package 测试 PASS（详见下表）。Host/client typecheck 在相同源码首轮复用依赖运行均 PASS。
- 源码已经从被测 `b6e5c474 + migration patch` 收敛到托管执行目录本身，未提交、未合入、未操作生产 checkout。`ws promote` 已确认此 Session mutable，未绕过依赖门禁。

| 当前主干候选包 | 最终测试 |
|---|---|
| session-links | 59 PASS |
| session-title-copy | 23 PASS |
| sidebar-session-provider-icon | 28 PASS |
| home-network-model-guard | 73 PASS |
| system-clock | 21 PASS |
| cockpit-memex-browse-shim | 11 PASS |
| cockpit-worktree-open-shim | 4 PASS |
| dsh-memex | 350 PASS |
| dsh-pet | 161 文件 PASS / 3 skip；2863 PASS / 43 skip |
| worktree-session | 32 文件 / 218 PASS（测试 PATH 用 corepack pnpm@10.23.0） |
| subscriptions-sandbox-shim | 28 PASS / 1 skip |

- 首轮 Pet 因未构建 client bundle 1 fail、worktree 因 pnpm fixture 版本入口错误 2 fail 已记录；在 clean build 与正确版本入口上重新跑通过，无产品源码掩盖失败。
- 同一 clean 候选独立 HOME/DSH_HOME/XDG 的 **sync×2 成功，第二次 no changes，官方 dump-config 成功**。辅助 YAML 计数曾因默认 js-yaml 不认 `!!js` 失败，属于验收脚本错误，改用 loader 方言复跑成功；不能记成产品 dump 失败。当前仍未证明全 loader 实际执行或 GUI E2E。
- 旧 devbox 快照的辅助 memex 移植：24 文件 / 275 tests PASS，host/client typecheck PASS；sync ownership 38/38 PASS，均已实际执行。后续只推进 `b6e5c474` 完整候选，不把两套基线结果混写。

## 当前主干审查后修复与最终结果

- 修复共享配置patch与ConfigEditor没有同锁、disabled/deleted mergeConfig键残留、!!js表达式损坏三项实际缺陷；补owner-only原子替换、失败片段不发布、legacy原值恢复、未知账本拒绝与进程中断事务恢复。
- 最终devbox根测试 **321 total / 319 pass / 2 skipped / 0 fail**，artifact check与diff check PASS；五个修复文件源码SHA256和本机一致。之前291pass是修复前migration结果，不冒充最终。
- 最终`final-home`独立profile：Node环境代理启用后从首次schema fetch失败自然恢复，sync×2第二次no changes、官方dump207 PASS。事务恢复不等于断电持久性（无fsync）。
- 具体轻量证据：`openspec/changes/upgrade-dsh-0-2-0-runtime/checking/current-main-devbox-regression.md`；正式header fetch环、实际设置GUI、Pet live/cold/preset和Session/回滚仍未放行。

## 尚未放行 / 必须重新做的门禁

1. 完成**本机当前主干 `b6e5c474` 的**候选回归和构建身份验证，之后跑 clean sync/build ×2、官方 dump-config、完整 loader 和插件组合。现有 `83c69cf` 及旧 devbox 主干辅助结果可保留为证据，但不能覆盖较新主干能力。当前主干包回归与launcher已过，但完整Host实际启动重现正式header0.1.0与cost-meter fetch栈溢出；仅验收目录经官方CLI装入已审查a5011e0产物后，认证cookie链与注入boot的shell200通过、未见startup issue。正式manifest pin未改，不代表fetch问题正式交付或GUI全部通过。
2. 3.8 的 session-links 设置 UI 条件已经与用户澄清的窄兼容范围不一致，应按原能力保留与声明式配置共存检查修订，不得以缺少新增编辑器为由重新实现撤销的功能。memex 设置保存和私有 org key 共存、build×2 门禁仍需完成。
3. 4.5 memex 逐工作区路由、主入口、开关与人工设置/卡片/召回体验。
4. Pet：5.1 子代名额池；5.6 全量运行体路径（silent settlement、idle child、independent preset 冷恢复、exact child Session、存储单 writer）；5.7 完整启用流程、真实 Feishu/media（需要经批准的测试账号/空间和副作用边界）；5.8 UI 打开 locus child、实际 preset mount/tool surface。Pet readiness、preset catalog、普通 DSH `session/create`、markers 与单元测试不得代替。
5. Session v3→v4 的真实隔离副本重启/损坏/截断/0.1.5 恢复；私有 overlay 精确身份；6.1/6.3 精确候选清洁构建；6.4–6.6 生产备份、用户批准后的受控合入及既有 Web GUI 验收。
6. Cockpit 真实 A→B→A/pending 1→0 已验证，但不是完整黑盒 UI 流程、也不是 0.6 `forwards` 协议升级证明。Cockpit auth 临时产物有独立回滚材料；这不授权正式 pin、发布或 DSH 切换。

**最终判断：整体升级 NO-GO。** 不要通过删除部署生成文件、跳过私有 overlay、仅凭插件 readiness 或把 pin 指向未发布物来推进。只读 GUI/旧验证日志不是修复候选的全栈证明。

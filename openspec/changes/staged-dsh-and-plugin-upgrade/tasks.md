## 1. 阶段一:零 host 依赖的低风险升级

- [x] 1.1 记录阶段基线:运行 `npm test`、`npm run check:artifacts` 并记录结果;记录当前启动清单(`node scripts/plugin-list.mjs`,应为 20 项含 `dsh-width-tiers [patch]`),作为后续阶段的比对锚点。
- [x] 1.2 `dsh.yaml` 将 `dsh-cockpit-bridge` 升到 `0.2.1`(release asset tarball),更新 note 记录 0.2.1 的 capability 失效自愈与"纯续签不再重申 current"修复。
- [x] 1.3 `dsh.yaml` 将 `llm-subscriptions` 从 fork commit tarball 切回 npm `dsh-plugin-subscriptions@0.6.0`:移除 `name` 字段(npm spec 可省略)、移除临时 fork 的 ⚠ 说明段,note 改为记录上游 PR #40 已合并(2026-08-29)及 `0.6.0` 对 `0.1.1-rc.2`/`0.1.2-alpha` 双运行体兼容。
- [x] 1.4 `dsh.yaml` 将 `cost-meter` 升到 `1.7.10`,note 补记:密钥治理变更(明文 key 不再落盘、迁入 DSH 凭据库、设置页改 write-only)、网络声明面扩至 19 域但仅在启用对应 Provider 时出站、`1.7.0`/`1.7.8`/`1.7.9` 曾致启动即崩故取 `1.7.10`。
- [x] 1.5 执行 `node scripts/sync.mjs` 物化,并连续运行第二次确认幂等(第二次应为 `no changes`)。
- [x] 1.6 验收:重启 DSH 并确认宿主正常启动(cost-meter 冒烟——排查 `plugin tree failed to load` / `Cannot access` / `strict codec`);启动清单仍为 20 项;Web 端确认 cost-meter 费用展示、subscriptions 模型选择器与设置页可用;确认 subscriptions 的「每模型默认推理档」功能仍在(该功能来自 PR #40,现由 npm 版本承载)。
- [x] 1.7 提交为独立 commit,使回滚粒度与阶段一致。

## 2. 阶段二:width-tiers 升级并原子回收手写接线

- [x] 2.1 复核 `dsh-width-tiers@1.0.4` 自带的 `cordis.patch.yml` 与 `patches/width-tiers-wiring.yml` 语义等价(两者均为无 `id` 的 `insert`,插入 `id: dsh-width-tiers` / `name: dsh-width-tiers` 一行)。
- [x] 2.2 **同一批次**完成两处变更:`dsh.yaml` 中 `width-tiers` 升到 `1.0.4`,同时删除 `width-tiers-wiring` 的 patch 条目;删除 `patches/width-tiers-wiring.yml`。二者不得分两次提交。
- [x] 2.3 确认升级后 `dsh-width-tiers` 具备 `dsh.bundle`,因而由 `sync.mjs` 正常纳入 `dsh.profile.bundles`(此前因只有 `dsh.client` 而被有意排除)。
- [x] 2.4 `node scripts/sync.mjs` 物化并连续两次确认幂等;确认生成的 `~/.dsh/profiles/web/cordis.patch.yml` 不再包含 width-tiers 片段。
- [x] 2.5 验收重复加载不变量:`node scripts/plugin-list.mjs` 中 `dsh-width-tiers` **恰好出现一次**,且 `[patch]` 标注消失(改由 bundle 承载);交叉验证 `dsh --profile web --dump-config` 中该 id 的 loader 行同样只有一条。
- [x] 2.6 验收功能:Web 端确认对话区宽度五档切换仍可用且 localStorage 记忆正常。
- [x] 2.7 提交为独立 commit。

## 3. 阶段三:better-sidebar 升到兼容上界

- [x] 3.1 复核 `dsh-better-sidebar@0.17.1` 的 peer 确实接受当前运行体(`@deepseek-ai/cordis ^4.0.1`、`dsh-* ^0.1.0-rc.8`),并确认 `0.18.0` 因 `cordis ^4.0.2` + `dsh-* ^0.1.2-rc.1` 不可用于当前阶段。
- [x] 3.2 `dsh.yaml` 将 `better-sidebar` 升到 `0.17.1`,note 补记该版本为 `0.1.2` 线双向兼容层(通往阶段四的过渡),以及 `0.18.0` 的准入条件。
- [x] 3.3 确认 `node-pty` 原生构建仍被 profile 的 `allowBuilds` 批准(既有部署侧信任决定),必要时按 pnpm 提示重新批准。
- [x] 3.4 `node scripts/sync.mjs` 物化并连续两次确认幂等。
- [x] 3.5 验收:侧边栏各面板(文件/编辑器/终端/Git/浏览器)可开且无 console 报错;确认无 duplicate prefix route 报错(防与 aggregate bundle 双挂载)。
- [x] 3.6 回归依赖方:`session-links`(peer `dsh-better-sidebar ^0.16.0`)的「文档/资料」tab 仍正常注册与计数;`sidebar-qa@0.4.0` 划选提问仍可用。
- [x] 3.7 提交为独立 commit。

## 4. 阶段四前置:spike 调研(门槛,不通过则停)

- [x] 4.1 查清 `@deepseek-ai/dsh-client-runtime` 在 `0.1.2` 线的接口承接方式:逐一确认 `dsh-api-session-controller`、`dsh-client-ui-session`、`dsh-client-ui-chat`、`dsh-client-ui-approval` 各自承接了哪些原接口面,并确认原 `ctx.connection.api.sessions.*` 的替代形态(已知 `0.1.2` 引入 `ctx.remote.session.*`)。
- [x] 4.2 逐包评估改动量:对 7 个 inject 了 `dsh-client-runtime` 的自研包(`dsh-pet`、`worktree-session`、`system-clock`、`session-links`、`session-title-copy`、`sidebar-session-provider-icon`、`home-network-model-guard`),分别列出需改的 inject 声明、调用点与预估改动规模;区分"仅改 inject 即可"与"需改写调用形态"两类。
- [x] 4.3 确认 spike 时点的 registry 实况:`@deepseek-ai/dsh` 的 `latest` 是否仍为 `0.1.2-rc.1`,据此确定阶段四的实际目标版本(design Open Questions 第三条)。
- [x] 4.4 复核阶段四放行项的准入:`better-sidebar@0.18.0` 与 `sidebar-qa@0.5.0`(或届时更新版)的 peer 与运行时服务需求是否被目标运行体满足;特别确认 `ctx.remote.session` 在目标运行体确实存在。
- [x] 4.5 输出 spike 结论:若改动量或不确定性超出可接受范围,在此停止并记录原因,不进入 4.6 之后的执行;结论写回本 change 的 design.md Open Questions。

## 5. 阶段四前置:固定升级前后的能力基线

- [x] 5.1 建立自动化基线并在**当前运行体**上先跑通一次、记录结果:仓库 `npm test`、`npm run check:artifacts`,以及各自研包自有的 build/typecheck/test(worktree-session 现为 29 文件 201 例)。
- [x] 5.2 建立人工验收清单,覆盖已知无自动化覆盖的行为,至少包含:`packages/worktree-session/src/index.ts` 的 `agent/session-start` 编排时序(同步跳过 guard 安装 + 异步落盘),来自 `2026-09-04-release-binding-when-worktree-is-gone` 归档记录;为每项写出可执行的验收步骤与预期结果。
- [x] 5.3 为每个自研包补充最小可观测的"插件确实加载并可用"判据(对抗静默不激活):明确每个包在 Web 端的可见证据(如 system-clock 的设置页时钟、session-title-copy 的标题徽标、sidebar-session-provider-icon 的会话行 logo 等)。
- [x] 5.4 在当前运行体上完整执行一次基线(自动化 + 人工),记录为升级前基准;未跑通的项必须在升级前标注为"升级前即失败",避免升级后误归因。

## 6. 阶段四:运行体迁移与自研包重接线

> **⛔ 已在 4.5 阀门停止(2026-09-04)**。6.2–6.4 实际执行后,6.5 暴露出 spike 未覆盖的
> **host 半区破坏**(`Session.events` 移除、`connection.rpc.handle` 删除 `{authority:'loopback'}`
> 参数、`SubagentRuntime.registerContinuableSetup` 移除),5 个包无法构建。按 tasks 4.5 的
> 阀门条款停止并回退,结论见 `design.md` 的「阶段四执行结论」。阶段四应作为独立 change
> 重新提案,spike 须同时覆盖 host 与 client 两个半区。下列未勾选项保持未完成状态。

- [x] 6.1 创建隔离 Worktree Session(独立 `DSH_HOME`)作为阶段四工作区,确认其构建不影响主 checkout 的日常 GUI。
- [ ] 6.2 `dsh.yaml` 将 `dshVersion` 升到 spike 确定的目标版本(预期 `0.1.2-rc.1`),确认 cordis 随之解析为 `4.0.2`。
- [ ] 6.3 按 4.2 的评估逐包重接线 7 个自研包的客户端半区;对 `dsh-client-runtime` 这一上游已移除的包,改为声明实际承接包或移除,**不得**机械改写为 `^0.1.2-rc.1`(该版本不存在)。
- [ ] 6.4 同批更新全部 8 个 local package 的运行体 peer 至新版本族,使 `tests/local-package-peers.test.mjs` 重新通过;不得通过放宽检查、豁免个别 package 或跳过检查来消除失败。
- [ ] 6.5 各自研包分别通过 build / typecheck / 自有测试。
- [ ] 6.6 `node scripts/sync.mjs` 在隔离环境物化并连续两次确认幂等。
- [ ] 6.7 复跑 5.4 的完整基线并与升级前基准逐项比对;任何失败项必须先比对升级前结果再归因,不得未经比对即断言为升级导致。
- [ ] 6.8 放行后置插件:`better-sidebar` 升至 `0.18.0`、`sidebar-qa` 升至 `0.5.0`(或 4.3/4.4 确定的版本);逐项确认实际加载并可用,特别验证 sidebar-qa 的划选提问确实激活(对抗静默不激活)。
- [ ] 6.9 隔离环境验收通过后,回主 checkout 物化并复跑基线;确认日常 GUI 全部 20+ 插件正常加载(启动清单项数与预期一致)。
- [ ] 6.10 提交为独立 commit(`dshVersion` 与 8 包 peer 同批),使回滚粒度与阶段一致。

## 7. 收尾

- [ ] 7.1 更新 `dsh.yaml` 各条目的审查记录,使 note 反映升级后的实际版本、信任面与已知约束。
- [ ] 7.2 复核本 change 的 spec 是否已反映最终行为;如阶段四实际做法与 design 决策不一致,先更新 design/specs 再归档。
- [ ] 7.3 `openspec validate staged-dsh-and-plugin-upgrade --strict` 通过;仓库 `npm test`、`npm run check:artifacts` 通过。
- [ ] 7.4 归档本 change,并把 spike 中发现但未处理的事项(如后续插件升级、遗留兼容问题)写回 `BACKLOG.md`。

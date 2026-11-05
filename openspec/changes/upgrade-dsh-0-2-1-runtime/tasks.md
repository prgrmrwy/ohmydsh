## 1. W0 基线（0.2.0-rc.2）

- [x] 1.1 在现役运行体上跑 `npm test`、`npm run check:artifacts` 与各 local package 的 build/typecheck/test，结果记入 `checking/baseline.md`
- [x] 1.2 列出无自动化覆盖的人工验收项及步骤：Pet Locus 子任务完成回传、AUTO 子会话路由、memex 记忆召回/写卡、Automation 现有任务清单（名称与下次触发时间）、btw、better-sidebar 各 tab、cockpit-bridge 上报、四个商店包的可见功能
- [ ] 1.3 在现役运行体上执行 1.2 的人工项并记录（未在 0.2.0-rc.2 隔离实例逐项复跑；旧版以现役日常使用为准，见 checking/candidate.md「与计划的偏差」）

## 2. W1 前置波次（0.2.0-rc.2 上线）

- [x] 2.1 将 `@michengai/dsh-btw` 从 fork tarball 回收为 npm `1.3.2` 精确 pin，复读发布物（出站、凭据、写盘）并更新 note，删除 PR 构建与 schedule 工具集相关的临时说明
- [x] 2.2 判定 `dsh-width-tiers` 2.0.2 是否作为前置升级：对比 2.0.1 发布物差异，可前置则同批改 pin 与 integrity（结论：只含针对 0.2.2-alpha.3 侧栏抽屉与软键盘的 UI 调整，对 0.2.1 无收益，留给 0.2.2 change）
- [x] 2.3 `dsh build`，连续第二次无变更；刷新现有 GUI，验收 btw（含主会话 cache 命中）与 width-tiers；记录证据（与运行体批次在同一隔离候选中验收，偏差见 checking/candidate.md）
- [ ] 2.4 W1 提交并经用户批准合入、部署

## 3. W2 审计（0.2.1-rc.5 破坏面）

- [x] 3.1 阅读 `docs/architecture/dsh-plugin-integration-pitfalls.md`
- [x] 3.2 对照 `dsh-v0.2.0-rc.2...dsh-v0.2.1-rc.5` 审计子代理执行/完成通知与 `session/wait` 变化对 dsh-auto-model-routing、dsh-pet、dsh-memex（裁判子会话）、worktree-session 的影响，host 与 client 两个半区分别给出结论
- [x] 3.3 审计 Agent Team 直投 Inbox（移除 outbox/重试/去重）对 dsh-pet、dsh-collab、auto-model-routing teammate 路径的影响
- [x] 3.4 逐项核对其余破坏项：`./invariant` 导出移除、子路径插件不读独立 `package.json`、agent-instructions 去掉 `dshHome` 行配置、工具展示 `both` 移除、API Key 读取优先级、azure 提供方改名、官方 connection 行是否已自带 webServer
- [x] 3.5 审计结论写入 `checking/api-audit.md`；超出预估的破坏点先补记再推进

## 4. W2 运行体原子批（隔离候选）

- [x] 4.1 `dshVersion` → `0.2.1-rc.5`；skill-filesystem、mcp-client provider pin 同步改为 `0.2.1-rc.5` 并更新 integrity
- [x] 4.2 删除 `dsh-experimental-schedule-bundle` manifest 条目及其 patch（如有），确认 sync 卸载干净
- [x] 4.3 全部 local package 的 `@deepseek-ai/dsh-*` devDependencies 改为 `^0.2.1-rc.5`，更新根 lockfile
- [x] 4.4 按 3.x 审计结论适配代码（保持语义等价），每个 package 跑 build/typecheck/test
- [x] 4.5 清理写死 `0.2.0-rc.2` 的脚本、测试与 note
- [x] 4.6 若 connection 405 修复片段已不需要，删除 `patches/connection-webserver.yml` 与条目；否则在 note 中记录复核结论（结论：仍需要；官方删除 webRuntime，改为 inject [webStartup, webServer]）
- [x] 4.7 按 rc.5 重新生成 noPet 官方模块名册（方法复现 rc.2 名册，仅去掉不存在的 dsh-terminal-pwsh）
- [x] 4.8 dsh-pet-executor / locus-base：去掉 `{{cwd}}` suffix 与已删除的 `backgroundMode`，移除 0.2.1 默认组合不再装载的 `tool-ralph`（与官方 standard 的其余漂移另行决策）
- [x] 4.9 dsh-pet：startActivation/drainChildren 迁移；Locus 工具上限改为 `locus-child` preset + 同 scope `tools.restrict` 重放并读回（等价性测试 `test/locus-child-preset-runtime.test.ts`）
- [x] 4.10 dsh-memex：裁判改用 startActivation + memex-eval-judge preset；门禁精确接受 working-directory 上下文行；jsonl 版本闸门扩到已审计集合
- [x] 4.11 根依赖布局：运行体包单实例 hoist、无缺失 peer（design D1a）

## 5. W3 运行体兼容声明

- [x] 5.1 改写 `tests/local-package-peers.test.mjs`：`engines.dsh` 必须存在且与所有 dsh peer 同值；区间形如 `>=X <M.(N+1).0-0`；`dshVersion` 在含预发布语义下满足区间；devDependencies 等于 `^<dshVersion>`；禁止精确 pin、`<M.(N+1).0` 与无上界；报错指出 package、字段、依赖名与实际值
- [x] 5.2 为检查补测试：覆盖 spec 中每个 Scenario（含 0.2.0-rc.2→0.2.1-rc.5 仍在区间内的情形）
- [x] 5.3 为全部 local package 写入 `engines.dsh` 与同值 peer，默认 `>=0.2.0-rc.2 <0.3.0-0`；需要抬下界的包按 D5 记录理由
- [x] 5.4 `npm test` 通过（754 项：751 通过 / 0 失败 / 3 跳过）

## 6. 候选验收

- [x] 6.1 `dsh build` → `ws prepare-preview` → `dsh`，按最小分组（裸运行体 → local package → remote 插件）逐组组合，记录启动清单、loader 结果、功能证据与基线差异
- [x] 6.2 用真实 Session/Pet/Automation 备份副本验证打开、继续写入、重启后一致；确认是否发生单向格式迁移，并据此补全回滚步骤
- [x] 6.3 复跑 1.2 全部人工项；重点验证子任务完成通知回到父会话、Automation 旧任务仍在官方页面、better-sidebar 0.26.1 激活
- [ ] 6.4 devbox 清洁构建 gate：按精确 commit 在 devbox 隔离执行构建与场景矩阵
- [x] 6.5 四个商店包在候选（0.2.1-rc.5）与现役（0.2.0-rc.2）上分别验证当前代码，结论写入 `checking/store-packages.md`，并据此确定各包下界

## 7. 原子切换（需用户批准）

- [ ] 7.1 备份 `~/.dsh/sessions`、Pet SQLite、profile 并校验完整性；写下回滚步骤
- [ ] 7.2 合入后从主 checkout 执行 `dsh build`，连续第二次无变更
- [ ] 7.3 由用户决定重启；重启后用 `dsh history` 核验结果，刷新 3080 完整验收

## 8. W4 商店包发版（切换验收后）

- [ ] 8.1 按 `checking/store-packages.md` 为需要发版的包升版本号并更新 CHANGELOG/README 中的兼容说明
- [ ] 8.2 使用 `publish-dsh-plugin` skill 的日常发版流程：主仓推 main → mirror-release 打 tag → npm 与 GitHub Release 同版；核对 npm 上的 `engines.dsh`
- [ ] 8.3 经用户确认后提交商店条目固定 tarball 更新 PR
- [ ] 8.4 `dsh.yaml` 中商店包对应的本地条目版本与 note 同步

## 9. 收尾

- [ ] 9.1 `openspec validate upgrade-dsh-0-2-1-runtime --strict`，同步 delta 到 current specs
- [ ] 9.2 更新记忆卡 `dsh-021-upgrade-2026-11-verified-blockers`，归档 change

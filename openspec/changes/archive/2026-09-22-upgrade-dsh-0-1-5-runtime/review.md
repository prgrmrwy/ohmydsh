# 方案评审结论

## 总判定

- **Conditional GO**：可以进入实现准备与隔离迁移。
- **Production NO-GO**：当前不得直接改生产 pin、物化或切换现有 GUI。
- `pet-locus-independent-agent-inquiries` 不整体阻塞升级；当前 HEAD 已含相关 runtime seam 历史。本 change 单一承接 0.1.5 port，inquiry change 保留 G1–G5 产品语义，二者不得并行编辑共享 runtime 文件。

## 必须先解决的硬阻塞

1. **Pet compatibility runtime**：现役 overlay 精确锁定 0.1.2；旧 Subagent patch 不可机械移植，Storage patch 即使文本可应用也必须重建 provenance 并复跑事务、崩溃和双 writer。
2. **Worktree generic attachments**：`handoff.ts` 仍使用 `draftImages/imageIds/addImages`。迁移须转交官方 draft attachment id 并只调用一次官方 submit，不得创建第二套 operation/upload 确认协议。
3. **Session v0→v3**：首次打开备份副本可能发布新 generation，不是无副作用“冷读”；必须证明旧 generation 保留、新 generation 原子发布、lease 排他和中断恢复。
4. **全部 local runtime bindings**：9 个 package 均仍为 `^0.1.2-rc.1`，且 prerelease semver 不接受 0.1.5；版本声明、lock 和真实 host/client 适配必须原子完成。
5. **Web/安全新面**：file-upload/resources/workspace-files/open-in-app 与 outbound proxy 尚未有完整验收；尤其 workspace-files read 不等价于普适 workspace containment。

## 插件升级矩阵

### 有明确升级目标

| 插件 | 当前 | 候选 | 判定 |
|---|---:|---:|---|
| cost-meter | 1.7.10 | 1.7.30 | peer 明确覆盖 `^0.1.5-0`；升级后实测费用、凭据与网络 |
| width-tiers | 1.0.4 | 1.0.5 | 1.0.5 把旧 details panel seam 迁到 rightbar，属于必要适配 |
| better-sidebar | 0.18.0 | 0.19.1 | peers/inject 已迁到 0.1.5/sidebar-right；需 node-pty 与组合验证 |
| skin-center / session-archive | 0.3.16 | 0.3.24 | 声明 DSH >=0.1.5-rc.1；archive 需 Node >=22.19 或 >=24 |
| cockpit-bridge | 0.3.0 | 0.4.0 | 0.4.0 保留 selection/pending seam并新增 editorOpen；需组合验收 |

### 必须保留但需要兼容证明

- **subscriptions 0.8.0 → 0.9.2 peer-only compatibility fork**：精确 0.1.5 包树审计确认运行源码/API 已适配，最小 production patch 只给 attachment/home-paths/llm/tools 四个 peer 追加 `|| ^0.1.5-rc.2`；runtime 源码、client inject、cordis patch 无需修改。fork CI 另更新 devDependencies、dsh-agent augmentation 和测试依赖。必须在正常 profile 完成尚未取得的 Host smoke，并验证 18 条 auth route、codex/claude/grok/copilot/antigravity、凭据、目录、stream/tools/media、proxy 与 sandbox shim；不能用禁用绕过。

### 用户决定移除

- **open-in-vscode 0.1.6**。
- **sidebar-qa 0.5.0**，不升级到 1.0.0；better-sidebar 因 local session-links 仍需保留。
- **setting-restart 1.0.0**。

### Archify 保留

- **archify-dsh 0.1.0 是当前唯一的 Archify Skill 来源**。它没有 Host/Web/网络能力，只通过 filesystem provider 加载包内完整 Skill；用户确认保留。本轮验证 provider 唯一以及生成、validate、deliver、visual-check、导出可用。

### 保留并复验

- **opencode-session-header 0.1.0**：0.1.5 未发现官方 x-opencode-session 支持；保留并验证目标域注入、非目标域不注入。
- **Trae bridge 0.1.12 → 0.1.15**：0.1.15 peers/API 明确覆盖 0.1.5；继续使用 repo 默认 `enabled:false + enabledEnv`。只在 devbox 证明本地启用意图，并在隔离 allowlisted 环境设 `DSH_TRAEX_BRIDGE=1` 实测，同时验证 unset/0 不安装。host/lumevm 由用户在 devbox gate 通过后手动部署，不纳入本 change 的验收证据；不得提交任一机器的 `.env.local` 或凭据。

## Pet / 并行 change 边界

- 当前可以推进裸 0.1.5、Session、non-Pet local、Worktree 和 remote plugin 各批，不需要等待 inquiry G1–G5。
- 升级期间下列区域执行 single writer：`dsh.yaml`、根 lock、`packages/dsh-pet/package.json`、`packages/dsh-pet/compat/subagent/` 全部 patch/build/provenance、Pet runtime probes，以及直接消费 Agent/Inbox/Session/Storage seam 的 locus/inquiry/collaboration 文件。
- isolated queued-turn claim 当前只在 tracked artifacts，launcher 没有启用 Agent override，因此不是现有生产基线。本次若启用则必须真实 probe；否则保持 unavailable 且 marker 缺失时 fail closed。
- Pet-enabled 生产切换至少要保持当前可达的 silent settlement、idle independent child、cold resume/saved preset、exact live child Session 和 Storage 原子能力。

## devbox 验收卡点

1. `set_sh_devbox_proxy` 必须与后续 git/npm/pnpm/corepack 处于同一个受控 login shell；先 `type`、再调用和检查 rc，不输出代理值。
2. fresh home 必须创建最小 profile `.npmrc`，公开包走 npmjs，内部 scope 默认不启用，避免继承用户 bnpm 导致公共包 404（U005）。
3. 临时验收 ref 必须绑定 expected SHA；远端 fetch 后记录 expected/fetched/HEAD 三个 SHA，清理时 compare-and-delete，漂移则保留报告。
4. 必须有明确 env allowlist、fresh `npm ci`、独立 npm/pnpm/corepack cache、独立 HOME/DSH_HOME，禁止 `.env.local`、`DSH_BIN` 或本地依赖泄漏。
5. Host/tunnel/browser/fixture/checkout 清理必须使用 ownership ledger；浏览器用独立 profile，本地端口不得为 3080，HTTP/DSH probe 才算 ready。
6. Session/Pet 数据使用脱敏真实副本或结构等价 fixture并明确差异；Worktree 场景使用 disposable Git fixture，不得拿候选 checkout 当被测仓库。
7. 清理顺序固定为浏览器→tunnel→远端 Host→Worktree fixture→checkout/home/cache→创建侧临时 ref；每项记录 done/not-owned/preserved，失败不得勾完成。

## 放行闸

- G0 目标 tag/commit/registry 身份未漂移。
- G1 0.1.2 基线完整且可复跑。
- G2 真实 Session 副本 v0/v1/v2→v3 与回滚演练通过。
- G3 9 个 local package 原子迁移并实际构建。
- G4 Worktree 官方 attachment 生命周期通过文本/图片/文件/失败场景。
- G5 Pet runtime provenance、能力与唯一依赖实例通过；Pet 是硬 gate，不能通过禁用或降级绕过。
- G6 Storage transaction/applyBatch/exclusive writer/crash recovery 通过。
- G7 devbox 上 subscriptions peer-only fork、Trae 启用组合及其余 remote loader/实际用户功能通过；用户已决定的三项完成干净移除。host/lumevm 不作为本 change 的验收 gate。
- G8 完整隔离组合及 devbox 精确 SHA 清洁构建通过。
- G9 本 change 以 devbox 完整验收、受控合入和 host/lumevm 手动部署清单收尾；不得把未由本 change 操作的机器写成已验收。

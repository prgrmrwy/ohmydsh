# LLM Subscriptions 升级 0.4.2 + 选型 ADR — Design

## Context

当前状态(动机见 proposal.md):

- manifest 锁定 `dsh-plugin-subscriptions@0.3.1`,其 Claude 走已废弃的 `claude.ai/oauth/authorize` + localhost 回调 → 登录即 `authorization failed`,`auth.json` 只有 codex。
- 上游 0.4.2 已重写 Claude(导入本机 Claude Code 凭据为主 + 新 CAI OAuth + live 模型目录),route id(`codex`/`claude`/`grok`)未变。
- 本机 codex 订阅会话有效(有效期至 08-29),`subscriptions-sandbox-shim` 按 `codex`/`grok` 路由包装,需保持兼容。
- 本机运行时解析到 `dsh-llm@0.1.0-rc.7`,V1ki 0.4.2 peer `^rc.5` 可满足;竞品 lninghaha(`dsh-coding-subscription-oauth@0.5.4`)peer **精确 `=rc.6`**,在 rc.7 解析下存在 npm peer 冲突风险(未实测)。

## Goals / Non-Goals

**Goals:**
- 消除 0.3.1 的 claude 授权失败(通过升级到 0.4.2 + 优先导入本机凭据)。
- 以 **ADR** 形式固化"现阶段用 V1ki、lninghaha 暂缓"的选型,并写明重新评估触发条件,避免以后再摇摆。
- 升级过程零破坏:codex 会话保留、shim 不需改动。

**Non-Goals:**
- 不推进 lninghaha 试用/迁移(触发条件见 ADR-0001,满足后再起新 change)。
- 不推进分布式/轴 B(多机委派装配)——已在 BACKLOG 挂起,另行立项。
- 不探测本机 claude 可用性(用户暂缓);claude 登录验证作为**验收任务**按需放行。

## Decisions

### ADR-0001: 订阅 provider 插件选型 — 现阶段继续 V1ki(dsh-plugin-subscriptions 0.4.2),lninghaha 列为待评估候选

- **Status**: Accepted(2026-08-20);重新评估触发条件见下。
- **Context**: 需要 claude+codex 作为 DSH 主对话的"模型提供方";未来有跨机/跨平台诉求(本机 mac、本机 VM lumevm、家用 Linux VM),且不排斥向插件仓库贡献代码。两个候选:
  - **V1ki `dsh-plugin-subscriptions@0.4.2`**:158⭐、每日提交;Claude 登录 = 导入本机 Claude Code 凭据(刷新写回 CLI 凭据库,与 CLI 共享会话);peer `^rc.5` 宽容;route id 与现有 shim/codex 会话兼容。
  - **lninghaha `dsh-coding-subscription-oauth@0.5.4`**:3⭐、每日提交;设备码登录 + 纯文件凭据(零 keychain/零子进程)、五 provider(grok/codex/kimi/claude/agy)、CLI 只读单向复制;协议委托官方 `pi-ai`;但 peer **精确 `=rc.6`**,且"复制不写回"存在与 CLI 各自刷新导致掉线的已知取舍(README 自述)。
- **Decision**: 主 Mac 升级 V1ki 0.4.2 并作为当前唯一选择器 provider 插件;lninghaha 不装、不迁。
- **理性依据**:
  1. 当前痛点(0.3.1 claude 授权失败)由升级直接修复,低风险(route/shims/codex 会话不变)。
  2. V1ki 的"刷新写回 CLI 凭据库"更适合"本机 DSH 主对话 + 本机 claude/codex CLI 长期同账号并发"(lninghaha 只读复制 → 双副本各自刷新,README 承认可能让 CLI 掉线)。
  3. lninghaha 的硬 pin(`=rc.6`)与运行体实际解析(rc.7)大概率 peer 冲突——在未验证前引入是"为躲麻烦制造新麻烦"。
  4. 分布式(轴 B)与插件选型正交(官方 subagent/ACP 平面),插件选型不应被分布式诉求绑定。
- **Consequences**:
  - 正面:claude 授权失败消除、codex 会话保留、shim 零改动、信任面变化(新增子进程)已记账。
  - 负面:跨机远程场景(lninghaha 的设备码、纯文件凭据)暂不享受;需在 VM 上另行证明 lninghaha 后才有对比数据。
  - 记账项:V1ki 0.4.2 引入 `execFileSync`(`claude --version` 探测 + keychain 读写),dsh.yaml 原"无 child_process"审查笔记对 0.4.2 不成立,随本 change 修正。
- **Re-evaluation triggers**(任一满足即重开选型,建议以"试用 lninghaha"立项):
  1. 需要在 VM/远程机上做纯 OAuth 订阅登录且本机/远程无 claude CLI 登录态(V1ki 0.4.2 在此场景 claude 登录按钮直接报错)。
  2. lninghaha 在 **VM 沙箱实机**验证通过:① npm 无 peer 冲突(rc.7 解析下);② 设备码 + CLI 只读拉取 + claude/codex 流式全绿;③ attribution 链路生效。
  3. V1ki 0.4.2 出现无法绕开的维护性回归(如 keychain 服务名与 claude 版本长期失配、上游停更)。

### Decision: 升级机制

- `dsh.yaml`:`llm-subscriptions` 条目 `spec: dsh-plugin-subscriptions@0.3.1` → `@0.4.2`,`version: 0.3.1` → `0.4.2`;重写 `note`(0.4.2 语义:claude 本机凭据导入、live 目录、子进程信任面、peer `^rc.5`)。
- manifest 其余条目不动;`subscriptions-sandbox-shim` 配置(`providers: [codex, grok]`)与规范不变。

### Decision: Claude 登录路径的预期行为(0.4.2 上游语义)

- 设置页点「登录」→ `SubscriptionsAuthController.login("claude")` 先 `readClaudeCodeCredentials()`(macOS keychain → `~/.claude/.credentials.json` 文件回退,尊重 `CLAUDE_CONFIG_DIR`);命中则「秒导入」并返回空 authorizeUrl(客户端按 "Instant login" 处理);未命中报"Run claude first to log in"。
- 刷新 `refreshClaude` 后经 `writeBackClaudeCodeCredentials` 回写 CLI 自己凭据库,带 stale-blob 乐观并发校验(CLI 先轮换则放弃并重读)。
- 待验证点(keychain 服务名 `"Claude Code-credentials"` 与本机 claude 2.1.221 是否匹配)列为验收任务,不在本设计内钉死。

## Risks / Trade-offs

- [0.4.2 与 rc.7 运行体有未实测边界] → 升级后先跑 codex 回归(现有会话),做 llm-probe 对照;异常即回滚 pin(见 Migration)。
- [claude 登录导入依赖 keychain 服务名/文件位置与本地 claude 版本一致] → 列为验收步骤;失配则回退手动流程(0.4.2 仍保留新 CAI OAuth + 粘贴回调),并贡献上游 issue。
- [0.3.1 会话字段与 0.4.2 读取兼容性] → codex auth.json 字段(access/refresh/expiresAt/accountId/idToken)两版本一致(比对源码确认),直接沿用。
- [信任面变化:新增子进程/security] → 审查笔记如实修正;不扩大沙箱/权限范围,凭据仍 0600 + 原子写。

## Migration Plan

1. 改 `dsh.yaml`(pin + note)→ `node scripts/sync.mjs`(或 `dsh build`)物化。
2. 重启 `dsh web`;启动日志确认 `dsh-plugin-subscriptions` 加载。
3. 回归(codex 可探测):保持现有 codex 模型选择器下发一条消息,验证流式 + 工具 + 用量;对照 llm-probe。
4. 验收(claude 按需放行):设置页点 Claude 登录 → 期待「秒导入」本机会话;若失败按明细定位(keychain 服务名/文件)。
5. 回滚:改回 `@0.3.1` + `dsh build` + 重启即可;codex 会话文件不因升级被改写,回滚无损。

## Open Questions

- 无——升级路径、选型依据、验收判据均已在设计内定稿;claude 登录的实机结果属验收任务,不改变本设计。

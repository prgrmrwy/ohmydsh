# LLM Subscriptions 升级 0.4.2 + 选型 ADR

## Why

当前 manifest 锁定的 `dsh-plugin-subscriptions@0.3.1` 的 Claude 接入走的是**已废弃的 claude.ai OAuth 授权路径**(`claude.ai/oauth/authorize` + localhost 回调),实测登录即报 `authorization failed`——claude 订阅无法落地,`auth.json` 里只有 codex。上游 0.4.2 重写了 Claude 接入(优先导入本机 Claude Code 凭据、新 CAI OAuth 端点、live 模型目录),并对选型做一次显式决策记录(ADR),避免以后在 V1ki / lninghaha 之间摇摆。

## What Changes

- `dsh.yaml`:`llm-subscriptions` 条目 spec `dsh-plugin-subscriptions@0.3.1` → `@0.4.2`。
- 修正 `dsh.yaml` 中过期的审查笔记:0.3.1 的"无 child_process"对 0.4.2 不再成立(新增 `execFileSync` 探测 `claude --version` + 读/写 keychain)。
- Claude 登录行为变化:**设置页点「登录」优先导入本机 Claude Code 会话**(macOS keychain → `~/.claude/.credentials.json` / `CLAUDE_CONFIG_DIR` 文件回退),找不到时走新 OAuth(`claude.com/cai/oauth/authorize` + 固定回调 `platform.claude.com/oauth/code/callback`)。
- Claude 模型目录变化:静态 3 模型 → `api.anthropic.com/v1/models` live 发现,附带 thinking/effort 能力声明。
- 新增 **ADR(Architecture Decision Record,落在 design.md)**:现阶段继续 V1ki 0.4.2;lninghaha(0.5.4)作为候选,带明确的重新评估触发条件(peer 冲突解除 + VM 沙箱验证全绿)。
- 明确**非目标**:本 change 不推进 lninghaha 试用、不推进分布式/轴 B(多机委派)装配。

## Capabilities

### New Capabilities
- `llm-subscriptions`: 订阅制 LLM provider(codex / claude / grok 路由)在 DSH 中的行为契约——登录方式、凭据存储与共享、模型目录、选择器出现规则。

### Modified Capabilities
<!-- 无:现有 specs(repo-layout / subscriptions-sandbox-shim)均无需求级变化。shim 路由名不变,继续兼容。 -->

## Impact

- `dsh.yaml`(manifest):`llm-subscriptions` 版本 pin 与审查笔记。
- profile 安装层(`~/.dsh/profiles/web`):`dsh-plugin-subscriptions` 0.3.1 → 0.4.2 npm 产物;`dsh build` 物化。
- 运行时行为:claude 登录/刷新/模型目录路径变化;codex 会话(auth.json)**保留不受影响**(路由 id 未变);`subscriptions-sandbox-shim` 适配器包装逻辑**不变**(仍按 `codex`/`grok` 路由匹配)。
- 信任面:0.4.2 新增子进程调用(`claude --version` / `security`),需在审查笔记与验收中明确。

## Why

`jev-workflow-router` 目前只靠 `AGENTS.md` 与 skill 目录让模型自己想起来调用。实测会话（Locus 会话路由与简洁回复优化，change `locus-ask-work-first-and-concise`）全程零次 Jev 调用：助手按项目惯例自己提议「开一个 OpenSpec change」时，把它当成规则已定，跳过了决策点；之后的轮次又按设计命中「用户已指定 / 已有 change」的跳过规则。缺的是「想起来」这一步，指令层面加强不够可靠，需要 Host 在固定时机提醒。

## What Changes

- 新增本地 Host 插件 `jev-workflow-router-hook`（`packages/jev-workflow-router-hook/`），订阅 `tools/post-execute`：
  - 触发时机：同一 agent 成功执行 `skill`（`name` 为 `openspec-propose`），或 `bash` 命令中含 `openspec new change`。
  - 条件：该 agent 此前没有加载过 `jev-workflow-router` skill，也没有调用过 Jev `jev_classify` / `jev_decide`；且该 agent 还没收到过本提醒。
  - 动作：原样接受工具结果，只附加一条带来源标签的提醒上下文，内容为「流程尚未确定时先按 `jev-workflow-router` 取一次建议；用户已指定流程或任务已属既有 change 时忽略」。
- 提醒永不拦截、不改写参数或结果，也不自己调用 Jev，不写记录文件。
- 开关：插件有自己的 manifest 条目；另外只要 `jev-workflow-router` skill 未部署到 `$DSH_HOME/skills/`，或设置了 `DSH_JEV_WORKFLOW_ROUTER_DISABLED`，插件就静默。关掉 router skill 即可连带关掉提醒。
- `dsh.yaml` 新增条目，在其 note 中注明与 router skill 的连带关系与移除步骤（router 条目 note 已接近长度上限，不改）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `jev-workflow-routing`：新增「Host 在 OpenSpec change 创建时机提醒取路由建议」的要求，包括触发、静默条件和非阻断约束；明确这次提醒属于已获批的自动化，不扩大「一行建议」之外的权限。

## Impact

- 新增 `packages/jev-workflow-router-hook/`（TypeScript Host 插件，仅依赖 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm` 类型与 `createUserMessage`）。
- `dsh.yaml`：新增 local package 条目；router skill note 更新。
- 不改 `dsh-openspec`、OpenSpec 源码、router skill 的调用契约或 recorder。
- 信任面：插件只读工具名与参数、检查一个本地文件是否存在、读取一个环境变量；不联网、不写盘。
- 部署需 `dsh build` 并重启 Host 才生效。

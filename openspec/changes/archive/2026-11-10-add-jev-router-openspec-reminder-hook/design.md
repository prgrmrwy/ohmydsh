## Context

- router 当前形态：`skills/jev-workflow-router/`（SKILL.md + recorder），由 `dsh.yaml` 的 `jev-workflow-router`（type: skill）启停；spec `openspec/specs/jev-workflow-routing/spec.md` 要求建议非阻断，且超出「一行建议」的自动化须另开 change。
- DSH 钩子（`@deepseek-ai/dsh-tools` `lib/types/events.d.ts`）：`tools/pre-execute` 只能 allow/deny/ask；`tools/post-execute` 是 waterfall，返回 `PostToolDecision`（`contracts.d.ts:341`），`accept`/`block` 都可带 `additionalContexts: UserMessage[]`。监听按 agent scope 过滤，`exec.agent` 标识调用方。
- 官方先例 `@deepseek-ai/dsh-repeat-tool-reminder`：在 post-execute 中先 `await next()`，再把自己的提醒 prepend 到下游 `additionalContexts`，保留 `block`；提醒用 `createUserMessage`（`@deepseek-ai/dsh-llm`）构造，且必须带 `source.kind`，否则在派生历史里会被当成用户输入；状态放在以 `exec.agent` 为键的 `WeakMap`。
- 工具形态（已核对运行体源码）：`skill` 参数 `{ name }`（dsh-tool-skill）；`bash` 参数 `{ description, command, ... }`（dsh-tool-bash）。Jev 工具名随接入方式不同（`mcp__jev__jev_classify`，经代理时为 `mcp__magpie__mcp__jev__jev_classify`），故按后缀匹配。
- 仓库内尚无使用 post-execute 的自研插件，`packages/worktree-session/src/host/guard.ts:147` 是 pre-execute 的先例。

## Goals / Non-Goals

**Goals**
- 在「即将建 change」这个时机让 agent 想起 router，覆盖模型自己提议开 change 的场景。
- 关 router skill 即连带关提醒；插件本身也可单独移除。

**Non-Goals**
- 不让 Host 替模型判断「是不是决策点」或自己调用 Jev（Host 无法得到需求的语义特征）。
- 不改 `dsh-openspec`、OpenSpec CLI 或 router skill 契约；不做通用的「change 创建前事件」。
- 不拦截 `openspec new change`。

## Decisions

1. **post-execute 附提醒，不用 pre-execute 拦截**。router 约定永不阻断；拦截还会挡住用户已指定流程的情况。代价是提醒在工具执行之后才到。
2. **两个触发点**：`skill name=openspec-propose` 是主触发，此时 change 还没建，schema 仍可选；`bash` 里的 `openspec new change` 是兜底（模型没走 skill 直接建 change），此时 change 已用默认 schema 建好，提醒仍可让 agent 在继续写 artifact 前给出建议。bash 匹配用正则 `\bopenspec\s+new\s+change\b`。
3. **「用过 router」的判断在插件内存里做**：同一 post-execute 监听观察 `skill name=jev-workflow-router` 与后缀 `jev_classify`/`jev_decide` 的调用，记在 `WeakMap<agent, state>`。不去解码会话日志：成本高，且属于集成陷阱 #4 所说的「结构须实测」区域。代价：Host 重启后恢复的会话可能多收一次提醒，可接受。
4. **每 agent 至多一次**，避免反复提醒。
5. **开关**：插件独立 manifest 条目（`type: package, source: local`），这是现有 local package 的标准形态。sync 没有「skill 附带 package」的机制，为此加机制得不偿失。连带开关靠运行时检查：每次命中触发时检查 `$DSH_HOME/skills/jev-workflow-router/SKILL.md` 是否存在、`DSH_JEV_WORKFLOW_ROUTER_DISABLED` 是否为真（与 recorder 同一正则）。只在命中时检查，开销可忽略。`DSH_HOME` 缺省为 `~/.dsh`，与 sync 的口径一致。
6. **提醒文案**（中文，单条）：说明「即将/已在创建 OpenSpec change；若用户没有指定流程且任务不属于既有 change，先加载 `jev-workflow-router` skill 取一次建议，再继续；否则忽略本提醒。」来源 `{ kind: 'jev-workflow-router-hook', form: 'notice', summary }`。

## Risks / Trade-offs

- [模型仍可能忽略提醒] → 只能缓解，无法消除；保持文案短、可执行。
- [误触发：用户已指定流程时也会提醒] → 文案明确「已指定则忽略」，router skill 自身的跳过规则仍生效，最坏是一条多余上下文。
- [DSH 升级改变 post-execute/附加上下文语义] → 升级复核项写进 manifest note；测试覆盖 decision 组合。
- [`source.kind` 未被渲染为通知] → 部署后在预览中实测一次提醒的呈现（陷阱 #4、#5）。

- [bash 匹配是启发式] → 经脚本、别名或管道间接执行的 `openspec new change` 会漏掉；主触发仍是 `openspec-propose`，这是已知限制。

## 已确认的取舍（2026-11-10 用户确认）

- 开关：独立插件条目，加运行时检查。不把 router 迁成「包内带 skill」的 local package（`dsh-auto-model-routing` 用的是那种形态），以免移动 skill 和 recorder 路径。
- 入口：只覆盖 `openspec-propose` 与 `openspec new change`，不覆盖 spec-superflow 的 `workflow-start` 和 Anvil。
- 子 agent、fork 各自独立计数，每个 agent 至多提醒一次。

## Migration Plan

新增条目 → `dsh build` → 重启 Host。回滚：条目 `enabled: false` → `dsh build` → 重启。无状态、无数据迁移。

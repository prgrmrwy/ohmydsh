# dsh-jev-workflow-router-hook

[English](README.md) · 简体中文

<!-- problem -->
`jev-workflow-router` skill 只有在模型自己想起来时才会被调用。模型按项目惯例主动提议开 OpenSpec change 时，常把规则当成已定，直接跳过 router。这个 Host 插件补上这一步：agent 即将创建 change、而且还没用过 router 时，在工具结果后附一条简短提醒。

**安装。** 通过 `dsh.yaml` 管理（条目 `jev-workflow-router-hook`，`source: local`）：设为 `enabled: true`，运行 `dsh build`，然后重启 DSH。规范：OpenSpec `jev-workflow-routing`，change `add-jev-router-openspec-reminder-hook`。

## 行为

- 监听 `tools/post-execute`。触发点：`skill` 调用且 `name` 为 `openspec-propose`（主触发，此时 change 还没建）；或 `bash` 命令含 `openspec new change`（兜底，此时 change 已建好）。
- 仅当同一 agent 没加载过 `jev-workflow-router`、也没调用过名称以 `jev_classify` 或 `jev_decide` 结尾的工具时才提醒，每个 agent 至多一次；子 agent、fork 各自计数。
- 提醒是带来源标签的通知（`source.kind: jev-workflow-router-hook`），加在 `additionalContexts` 最前面；工具结果、下游的 `block` 和其他上下文都原样保留。
- `$DSH_HOME/skills/jev-workflow-router/SKILL.md` 不存在（router skill 已禁用），或 `DSH_JEV_WORKFLOW_ROUTER_DISABLED` 为 `1`/`true`/`yes`/`on` 时静默。
- 已知限制：状态只在内存里，Host 重启后恢复的会话可能多收一次提醒；经脚本、别名间接执行的 `openspec new change` 识别不到。

## 边界

不拦截、不拒绝、不改写任何调用，不调用 Jev，不写文件，不联网。是否调用 router 仍由 agent 按 skill 自己的跳过规则决定。

## 移除
<!-- section: removal -->

连接 DSH 工具管线与 `jev-workflow-router` skill。在 `dsh.yaml` 里设 `enabled: false`，运行 `dsh build` 并重启 DSH 即可移除，不留数据。只禁用 router skill 也会让它静默。

# presets/ — agent preset 定制

[English](README.md) · 简体中文

<!-- problem -->
preset 决定一个 agent 会话拿到哪些工具与 composition。这个目录存放本仓库自己定义的 preset，用于会话需要与官方 `standard` preset 不同的 roster 的少数场景；目前只有 Pet 执行会话用的那一个。

DSH 官方 `standard` 会自动加载，环境级通用指导由顶层 `agentInstructions` 物化到 `$DSH_HOME/AGENTS.md`。不要仅为承载模型指导复制官方 preset；此类单例指导应维护在 `instructions/` 并由 `agentInstructions` 部署。只有确实需要独立 roster/composition 时才新增 preset。

当前唯一的 preset 是 `dsh-pet-executor`（Pet 任务执行会话，与 `standard` 的唯一差别是不加载 skill-filesystem）。

每个子目录 = 一个 preset：

```
presets/<id>/
  agent.cordis.yml     # preset composition(必须;roster 认 agent.cordis.yml)
  preset.yml           # 显示元数据(name / description)
  VERSION              # 独立版本
  CHANGELOG.md
```

- 在 DSH 0.2+ 上 sync 不再复制目录：它把每个 enabled 的 preset 渲染成一行 `@deepseek-ai/dsh-agent-preset` 声明（`id: preset-<id>`）写入 profile patch，`plugins` 取自 `agent.cordis.yml`，显示用的 `name`/`description` 取自 `preset.yml`，并经账本清理 DSH 0.1.x 在 `.agent-presets/` 下留下的目录副本；
- 修改后重跑 sync 生效；**不要直接改 `~/.dsh` 下的任何内容**（真相源在仓库）；
- 新 preset 建议从 shipped preset 复制起步（shipped 位置见部署 `config/agent-presets/`，或 `agentPresets.copy()`），保证 composition 可加载。

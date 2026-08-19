# presets/ — agent preset 定制

当前仓库没有自定义 preset;DSH 官方 `standard` 会自动加载,环境级通用指导由顶层 `agentInstructions` 物化到 `$DSH_HOME/AGENTS.md`。通用 preset 支持仍保留,以后只有确实需要独立 roster/composition 时再新增。

每个子目录 = 一个 preset,官方 `~/.dsh/.agent-presets/<id>/` 机制的源码位置:

```
presets/<id>/
  agent.cordis.yml     # preset composition(必须;roster 认 agent.cordis.yml)
  preset.yml           # 显示元数据(name / description)
  VERSION              # 独立版本
  CHANGELOG.md
```

- sync 把 `presets/<id>` **复制**到 `~/.dsh/.agent-presets/<id>`(symlink 不被 roster 识别,已代码级确认);
- 修改后重跑 sync 生效;**不要直接改 `~/.dsh` 下的副本**(真相源在仓库)。
- 新 preset 建议从 shipped preset 复制起步(shipped 位置见部署 `config/agent-presets/`,或 `agentPresets.copy()`),保证 composition 可加载。
- 不要仅为工作环境级模型指导复制官方 preset;此类单例指导应维护在 `instructions/` 并由 `agentInstructions` 部署。

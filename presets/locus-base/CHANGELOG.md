# locus-base

## 0.1.0

- 新增白名单 preset：由短清单构建而非从 `standard` 删减，因此上游 `standard` 新增的行不会默认进入会话。
- 不含 `subagent`、`subagent_fork`、`workflow`、`ralph`、`send_message`、agent 控制与 job 控制行：
  委派是 `toolFilter` 关不上的逃逸面（按 agent 安装的行落在会话自有层，不受继承过滤约束），
  所以只能让它根本不在上限里。
- 不含 plan mode、goal 与 `skill-filesystem`。

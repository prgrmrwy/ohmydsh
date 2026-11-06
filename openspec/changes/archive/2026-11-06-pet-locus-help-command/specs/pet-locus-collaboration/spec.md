## ADDED Requirements

### Requirement: 控制命令帮助

`@bot -h`、`@bot --help`、`@bot /help`（及裸 `/help`）SHALL 在 IM 群、话题或文档评论中回复一条控制回执，列出当前可用的控制命令、参数形式与一句话说明，并注明哪些命令仅 allowlist 成员可用。帮助 SHALL 是纯控制命令：不得创建入口、子会话或业务 Delivery，且在已停止的入口上同样可用。回执文本 SHALL 由解析器所用的同一张命令表生成；已弃用的 `/scope`、`/tools` SHALL NOT 出现在其中。帮助与其他控制命令一样仅对 allowlist 发送者可用。

#### Scenario: 查看帮助

- **WHEN** allowlist 成员在入口发送 `@bot -h`
- **THEN** 入口收到一条回执，列出 `/bind`、`/unbind`、`/access` 的参数形式与说明，不含 `/scope`、`/tools`
- **AND** 没有任何入口、子会话或 Delivery 被创建

#### Scenario: 帮助与解析器一致

- **WHEN** 解析器的命令表新增或移除一个命令
- **THEN** 帮助回执随之变化，无需另行修改文本

#### Scenario: 已停止的入口仍可查看帮助

- **WHEN** allowlist 成员在已停止的入口发送 `@bot /help`
- **THEN** 回复帮助回执，而不是被当作停止入口拒绝

#### Scenario: 非 allowlist 发送者

- **WHEN** 非 allowlist 成员发送 `@bot -h`
- **THEN** 与其他控制命令一致，被静默拒绝（`control-not-allowed`）

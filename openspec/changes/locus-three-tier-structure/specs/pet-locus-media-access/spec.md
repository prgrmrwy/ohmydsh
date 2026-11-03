## MODIFIED Requirements

### Requirement: Locus project-read guard 限制 safe child 文件读取

系统 SHALL 在每个 safe locus child 的同步 prepublication 与 cold-restore composition 中安装 caller-bound project-read guard。Host SHALL 验证 exact child Session cwd、parent Session cwd 和 sandbox workspace root 一致；三者不一致、缺失或不可解析时 MUST veto child publication。`read`、`read_image`、`glob` 与 `grep` 只能访问 Host 从该入口持久化绑定的干活项目 workspace 解析并 canonicalize 的单一 project root。运行目录可以位于 `DSH Pet`，但运行目录自身不构成项目读取授权；项目根缺失或不可解析时 MUST veto child publication。模型与入站消息 MUST NOT 提供或覆盖项目根；Host SHALL 在业务 prompt 中提供项目绝对路径，跨目录读取须显式使用该路径。

路径授权 SHALL 使用 physical `realpath` 与路径边界比较，MUST NOT 仅用字符串前缀。DSH_HOME、Pet state 与 attachment roots SHALL 显式拒绝；project root 与任一拒绝根互相包含时 MUST veto publication。缺 path、不存在目标、相对越界和 symlink escape 均 SHALL fail closed。

#### Scenario: 项目内读取允许
- **WHEN** safe child 读取或搜索已确认 project root 内的真实文件
- **THEN** project-read guard 允许调用继续

#### Scenario: Pet 私有根读取拒绝
- **WHEN** safe child 尝试 glob 或 read DSH_HOME、Pet state、attachment root 或指向这些位置的 symlink
- **THEN** guard 在工具 body 前拒绝，不能枚举或读取私有数据

#### Scenario: Pet 运行目录与来源项目分离
- **GIVEN** locus 主子会话运行在 DSH Pet，入口持久绑定来源项目 workspace
- **WHEN** 子会话读取该项目的绝对路径，或读取 DSH/Pet 私有根及指向私有根的 symlink
- **THEN** 仅前者获准；省略路径的搜索仍按真实 cwd 判定并拒绝，不把运行目录当作额外读取授权；缺失项目根拒绝发布

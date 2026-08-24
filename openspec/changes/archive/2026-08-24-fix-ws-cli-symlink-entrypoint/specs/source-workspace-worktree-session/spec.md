## ADDED Requirements

### Requirement: Operator maintenance CLI is reachable through its published entrypoint

operator 维护命令面（`status`/`promote`/`clean`）SHALL 在其所有已发布的调用路径下真实执行，包括 npm `bin` 安装产生的 symlink、构建产物真实路径以及相对路径调用。当 CLI 以已发布的 `bin` 名称被调用时，系统 MUST 执行被请求的子命令并输出该子命令的结果或明确诊断。

系统 MUST NOT 在未执行任何安全检查的情况下以成功退出码静默返回。若入口无法执行请求的子命令，系统 SHALL 以非零退出码在 stderr 输出明确诊断，使调用方无法把“未执行”误判为“检查已通过”。

作为库被导入以获取其导出（例如 `main`）时，模块 MUST NOT 因导入副作用执行任何子命令。

#### Scenario: Invoke the CLI through its npm bin symlink
- **WHEN** operator 通过 npm 安装的 `bin` symlink（例如 `node_modules/.bin/dsh-ws`）执行 `status` 并传入有效的 worktree 绝对路径
- **THEN** 系统 SHALL 执行 status 并在 stdout 输出该 operation 的 JSON 报告，退出码为 0

#### Scenario: Invoke the CLI through the built artifact realpath
- **WHEN** operator 直接以构建产物真实路径执行同一 `status` 命令
- **THEN** 系统 SHALL 产生与经 symlink 调用一致的报告和退出码

#### Scenario: A dry-run cleanup through the bin entrypoint actually evaluates safety
- **WHEN** operator 通过已发布的 `bin` 入口执行 `clean --dry-run` 并传入有效 worktree 路径
- **THEN** 系统 SHALL 真实评估 containment、dirty-state 与 merge-ancestry 等安全门，并输出计划动作与 `dryRun: true`；系统 MUST NOT 在未做这些评估时返回成功

#### Scenario: Entrypoint cannot execute the requested command
- **WHEN** 入口因解析失败、缺失构建产物或未知子命令而无法执行请求的操作
- **THEN** 系统 SHALL 以非零退出码返回明确诊断，且 MUST NOT 以退出码 0 静默结束

#### Scenario: Importing the CLI module runs no command
- **WHEN** 其他模块导入 CLI 模块以使用其导出函数
- **THEN** 导入 MUST NOT 触发任何 status/promote/clean 执行或产生 stdout 输出

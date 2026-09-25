## ADDED Requirements

### Requirement: 第三方决策与工作流资源按精确来源可复现物化
仓库通过 manifest 管理的第三方决策服务包装、OpenSpec schema 或独立工作流 CLI/skills，必须(SHALL)记录上游来源、精确版本或 commit、许可、运行依赖、凭据边界、启用状态、升级复核点与移除路径。sync 必须(SHALL)从所记录来源可复现地物化资源，且不得(SHALL NOT)把 API Key、访问令牌或其它凭据写入仓库、生成文件、部署账本或日志。

第三方 OpenSpec schema 若声明为原样复用，物化后的 schema 内容必须(SHALL)可与所 pin 上游版本核对；独立工作流不得(SHALL NOT)被伪装成 OpenSpec schema。禁用或移除任一资源时，系统必须(SHALL)只撤销其受管部署产物，不影响标准 OpenSpec、其它 workflow、现有 change 或仓库源码。

#### Scenario: 物化精确 pin 的第三方资源
- **WHEN** manifest 启用了 Jev 决策包装、Anvil schema 或 spec-superflow 工作流资源
- **THEN** sync 从记录的精确来源物化对应资源，并可报告其版本、来源和部署状态

#### Scenario: 凭据由本机环境提供
- **WHEN** 第三方决策服务需要 API Key
- **THEN** sync 与运行时只从受支持的本机凭据或环境通道读取，仓库、生成文件和部署账本中不出现密钥值

#### Scenario: 原样 schema 发生本地漂移
- **WHEN** 已部署或仓库保存的原样第三方 schema 内容与所 pin 上游版本不一致
- **THEN** 校验或 sync 报告漂移且不得将其静默视为官方上游内容

#### Scenario: 禁用社区工作流资源
- **WHEN** 用户禁用 Anvil 或 spec-superflow 并重新运行 sync
- **THEN** 对应受管部署入口被可逆移除，标准 OpenSpec、已有 change 和其它定制保持不变

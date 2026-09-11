## ADDED Requirements

### Requirement: Customization 请求的兼容运行时仅作用于长期 Host

当启用的本地 `dsh-pet` customization 为统一 Locus 声明受支持的 Host runtime compatibility kind 时，启动器 SHALL 仅为长期 `dsh web` Host 准备并选择该兼容运行时。声明 SHALL 只包含实现已知的固定 kind 与已审查 DSH 版本，不得由 manifest 指定任意 builder 或可执行文件路径。未设置人类显式 `DSH_BIN` 时，build、sync、plugin、dump-config 及其它一次性官方 CLI 转交 MUST 继续按 `dshVersion` 使用官方精确版本，不得加载或构建 Pet overlay。

人类在调用前显式设置的普通 `DSH_BIN` SHALL 保持既有最高优先级并作用于所有命令。历史上由 `.env.local` 注入且精确指向当前 checkout Pet `.launcher/node_modules/.bin/dsh` 的值 SHALL 被识别、告警并忽略；调用方显式给出同一路径时 MUST NOT 被吞掉，其它路径也不得被猜测或删除。实际 Host runtime kind、owner、compatibility kind 与版本 SHALL 在启动控制台和启动历史中可审计。

#### Scenario: Host 使用 Pet compatibility 而官方命令不使用

- **WHEN** Pet 已启用、声明匹配当前 `dshVersion` 且调用方没有显式 `DSH_BIN`
- **THEN** `dsh web` 使用固定 Pet Host compatibility；`dsh build`、plugin 与 dump-config 仍使用官方精确版本，且不会触发 Pet builder

#### Scenario: 历史 env.local 值自动退出

- **WHEN** 调用方未设置 `DSH_BIN`，但 `.env.local` 注入当前 checkout 的历史 Pet launcher 路径
- **THEN** 启动器告警并忽略该值，由声明决定 Host runtime；官方 CLI 不被全局重定向

#### Scenario: 人类显式紧急覆盖保持优先

- **WHEN** 调用方在命令执行前显式设置任意 `DSH_BIN`，包括恰好等于历史 Pet 路径
- **THEN** 所有命令继续按既有契约优先使用该值，不再自动解析或构建声明式 Pet Host runtime

#### Scenario: Pet 禁用或删除兼容声明

- **WHEN** Pet effective disabled，或经上游能力审查后删除 compatibility 声明
- **THEN** Host 与一次性命令均使用官方精确 pin，声明不阻止 DSH 升级

### Requirement: Pet Host compatibility 版本与产物必须 fail closed

启用的 Pet Host compatibility `supportedDshVersion` MUST 精确等于 `dshVersion`。sync SHALL 在 profile scaffold、状态迁移、package build/install 或其它副作用前校验；plain Host start SHALL 独立复核。升级重写 SHALL 只更新官方 `dshVersion`，不得自动把旧补丁声明套到新版本；不匹配必须使 sync/Host start 失败并阻止启动。自动升级中的 sync 失败 SHALL 触发现有完整 manifest rollback。操作者必须重新审查上游后显式移除 compatibility，或更新固定 kind 的实现、补丁、验证与支持版本。

兼容构建 SHALL 具有跨进程共享锁与有界等待/执行时间，覆盖 Subagent、Storage artifact 与 launcher 全链；SHALL 以 fingerprint 复用已验证成品，只在缺失或过期时构建。fingerprint MUST 覆盖固定版本、补丁、builders、模板及 checkout canonical path。重建 SHALL 在同文件系统 sibling staging 中完成安装脚本审批、依赖唯一性、所有 override provenance、所需 capability marker、真实 DSH entry containment 与 `--version` 精确匹配验证，再原子发布；失败 MUST 保留旧 launcher，且本次启动不得静默回退官方 runtime。构建进度 SHALL 走 stderr 实时可见，server-bin stdout 只保留机器 marker。

#### Scenario: 官方版本升级不自动继承旧补丁

- **WHEN** 升级器把 `dshVersion` 改为新版本但 compatibility 仍声明旧审查版本
- **THEN** sync 在任何部署副作用前失败，自动升级恢复完整 manifest，且不启动新 Host、不自动重写 compatibility pin

#### Scenario: fingerprint 命中复用

- **WHEN** 相同 checkout、版本、补丁和 builder 已有通过完整自证的 launcher
- **THEN** Host 准备走 cached 快路径，不 clone、build 或 install，不访问 registry

#### Scenario: 并发首次准备

- **WHEN** 两个 Host 准备或 build 路径并发触发同一 compat 链
- **THEN** 只有锁持有者构建，等待者有界等待并复用完整发布结果，不互删源码、artifact、staging 或 launcher

#### Scenario: 重建失败保留旧成品

- **WHEN** fingerprint 过期后的新构建、安装或自证失败
- **THEN** 旧 launcher 继续完整保留供诊断或回滚，但本次 Host start 非零退出且不以官方 runtime 继续

#### Scenario: checkout 移动

- **WHEN** 仓库复制或移动到另一个 canonical path，旧产物含上一 checkout 的安装来源
- **THEN** fingerprint 失效并重建自包含 launcher，不复用旧绝对 file link

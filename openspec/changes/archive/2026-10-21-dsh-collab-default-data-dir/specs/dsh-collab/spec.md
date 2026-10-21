## MODIFIED Requirements

### Requirement: profile共享台账与生命周期封禁

台账 SHALL 位于活动DSH profile归属的持久状态目录，与workspace和插件部署副本分离。配置未给出 `dataDir` 时 SHALL 默认使用 `<DSH home>/plugins/dsh-collab`，其中 DSH home 按官方规则由 Host 进程环境的非空 `DSH_HOME` 决定，缺省为用户主目录下的 `.dsh`；给出 `dataDir` 时 SHALL 为绝对路径并优先使用。默认与显式路径都经过同样的 workspace/node_modules 围栏与 0700 校验，MUST NOT 由会话参数或模型输入决定。插件包 MUST NOT 自带禁用组合行：是否加载只由 profile 是否登记该 bundle 决定。服务身份 SHALL 在该profile内重启稳定。启动 SHALL 重放已有空间但不重投未完成意图。wrapper SHALL 在接纳create/open时即跟踪spaceId，dispose先同步关闭工具/provider准入，再关闭全部已接纳空间，等待在途存储而不等待无限期claim/恢复/投递。关闭后的旧命令或回调 MUST 不跨生命周期写入或发送。

#### Scenario: 未配置 dataDir 时使用 DSH home 下的默认目录
- **GIVEN** Host 进程环境 `DSH_HOME` 为临时目录 H，插件配置不含 `dataDir`
- **WHEN** 插件启动并创建空间
- **THEN** 台账写入 `H/plugins/dsh-collab`，该目录为 0700；不需要任何本机路径配置

#### Scenario: 显式 dataDir 优先且仍受校验
- **WHEN** 配置给出绝对 `dataDir`，或给出相对路径
- **THEN** 绝对路径时台账写入该目录、不创建默认目录；相对路径时插件以 `COLLAB_BAD_CONFIG` 拒绝启动

#### Scenario: 包不自带禁用行
- **WHEN** 读取已发布包内的 bundle 组合补丁
- **THEN** 其中 `dsh-collab` 行不含 `disabled: true`，profile 只要登记该 bundle 即加载

#### Scenario: 两workspace共享并重启重放
- **WHEN** A/B跨workspace写入后重启隔离Host
- **THEN** 空间、成员、收据和serviceId不变，未知投递只列pending，没有自动重发

#### Scenario: 待认领创建也受dispose保护
- **GIVEN** 创建停在provider claim，空间尚未open
- **WHEN** dispose完成后claim返回
- **THEN** 旧创建拒绝，无日志新建或新锁，不阻塞dispose等待外部SPI

#### Scenario: 存储失败不假成功
- **WHEN** 已接纳提交写入或fsync失败
- **THEN** 返回内核存储错误，后续操作不绕过failed状态；close/open后同cmdId按收据确定结果

### Requirement: 验收不触碰日常会话与部署

真实接缝验收 SHALL 使用独立临时 DSH_HOME/profile、合成会话与本地可控模型端点，不访问用户会话日志、密钥或外部模型。是否在日常 profile 启用由 manifest 的 `enabled` 决定；测试与验收不创建 GUI 或派生团队。真实 Host 测试若环境缺失 SHALL 报未验证而非用 mock 替代通过。禁用/移除 SHALL 关闭实例但保留台账，未来重启可显式恢复。

#### Scenario: 真实隔离Host验证完整接缝
- **WHEN** 在临时 profile 执行身份、忙闲唤醒、冷恢复，以及发行 Host 的正常停止、真实 dispose 预算耗尽和 SIGKILL 三个独立子验收
- **THEN** 记录真实启动/停止入口、运行体版本/摘要及预算来源；正常停止证明 close 后锁释放；预算耗尽与 SIGKILL 证明停止时残留锁，且随后同一数据目录的下一次 Host 启动按死亡证明自动清理该锁并重放日志；缺少发行入口或真实预算则对应项未验证；日常 profile 和用户会话文件树不变

#### Scenario: 未执行真实Host实验不能宣称完成
- **WHEN** 仅单元测试通过或真实 Host 前提缺失
- **THEN** 验收记录对应项未验证且不标绿，不以源码检查/模拟调用次数代替真实请求头、回合和锁的 oracle

#### Scenario: 移除保留持久日志
- **WHEN** 关闭插件并移除部署副本
- **THEN** 工具消失、存储句柄关闭，profile 持久台账字节不被删除，未触碰 workspace 文件

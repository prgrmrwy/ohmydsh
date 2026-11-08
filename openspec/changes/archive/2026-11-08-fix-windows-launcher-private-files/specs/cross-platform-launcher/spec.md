## ADDED Requirements

### Requirement: 私有启动补丁与停止发现文件按平台权限模型保护

启动器私有 patch、停止发现目录及含认证 URL 的文件 SHALL 使用平台真实权限模型。POSIX SHALL 保留当前 UID、目录 0700/文件 0600、run 不可被其他身份写入和符号链接拒绝规则。Windows SHALL 校验当前 token SID、实际 owner 及完整有效 DACL（含继承 ACE），不得用模拟 mode bits 代替。SYSTEM（S-1-5-18）与 Administrators（S-1-5-32-544）的 Allow ACE 是明确的 OS 特权例外，其它 Allow 主体 SHALL 拒绝；owner SHALL 为当前用户，仅管理员 token 可接受 Administrators owner。空/未知 DACL、无法证明的权限及 reparse/junction SHALL 拒绝。

#### Scenario: 显式或继承的普通身份权限拒绝
- **GIVEN** 私有目录或文件含 Everyone/AuthenticatedUsers 的显式或继承 Allow read ACE，或 run 含其 write/delete/WriteDac 权限
- **WHEN** 发布、读取或清理访问该边界
- **THEN** 操作失败，不发送认证请求或停止信号，且不改写该实体 ACL

#### Scenario: POSIX 权限反例保持生效
- **GIVEN** 私有目录为 0777、文件为 0644、owner 不符或路径为符号链接
- **WHEN** 在 Linux/macOS 访问私有文件
- **THEN** 按现有规则拒绝，不因 Windows 分支弱化检查

### Requirement: 私有文件创建和读取保持保守边界

新建 Windows 私有目录及 run SHALL 在创建时具有当前用户 FullControl、可安全继承的私有 DACL；文件 SHALL 在已验证私有目录内 wx 创建，发布前建立/验证同等 ACL。既有不安全目录/文件 SHALL 拒绝，不得自动改写其 ACL。读方 SHALL 保留 lstat/open/fstat 身份、类型及大小检查，接受已证明安全的继承 ACL，不把权限错误降级为文件缺失。失败 SHALL 在认证请求或停止信号前发生。

#### Scenario: Windows junction 与权限查询失败拒绝
- **GIVEN** run/私有目录是 junction，或权限工具缺失、超时、输出不完整
- **WHEN** 准备使用私有 patch 或停止发现文件
- **THEN** 有界非零失败，不访问重定向目标、不安装替代工具、不跳过检查

### Requirement: 独立停止发现生产者共享权限契约

无论 launcher noPet 插件还是独立安装的 Pet 发布，停止发现文件 SHALL 满足同一私有权限契约；独立 Pet SHALL NOT 依赖仓库 launcher 源码路径。此契约不改变停止协议字段、Connection 鉴权、活进程身份校验或 freeze/drain/resume 语义。

#### Scenario: 原生 Windows 的安全继承与跨生产者读取
- **GIVEN** 全新隔离目录与当前 Windows 用户，路径含空格和中文
- **WHEN** launcher 和未经过 launcher 初始化的独立 Pet 分别发布停止发现文件
- **THEN** 文件具有可证明的私有有效 ACL，launcher 可读取并继续原有鉴权流程；替换及本 boot 清理保留另一 boot 的文件

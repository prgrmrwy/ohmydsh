# Design

## Context

见 proposal 的 Why。失败点是 launcher 三处直接用 POSIX mode 检查 Win32 文件；Pet publisher 另有跳过 Windows mode/owner 的分支。仅在 launcher 预建目录不能覆盖独立 Pet、显式 DSH_BIN 或已有 Host；因此 producer 与 consumer 都需要本地实现同一权限语义。已有 StopDescriptor/请求/应答和 drain 端口均无需改变。

## Goals / Non-Goals

**Goals:** 在原生 Windows 使用实际 SID/DACL 安全建立并读取私有文件，保留 POSIX 及所有鉴权/进程身份保护；独立 Pet 同样可用。

**Non-Goals:** 不更改停止协议、不自动收紧未知既有 ACL、不启停当前部署 Host、不移除平台测试、不建立新的共享运行时 package。

## Decisions

1. 固定 PowerShell 5.1/.NET 脚本读取 token User SID 与数值化 ACL；通过 shell:false 的有界子进程执行，路径与动作仅由 stdin JSON 传入，不拼进代码，不解析本地化 icacls 输出。批量校验同一次操作涉及的目录，以控制冷启动开销。失败/不完整输出拒绝，不提供跳过开关。
2. 新目录通过带 DirectorySecurity 的原生创建接口，在凭据写入之前建立受保护、当前用户 FullControl、ObjectInherit/ContainerInherit ACL。允许安全的继承 ACE；owner 校验当前 SID，管理员 token 可接受 Administrators owner，SYSTEM/Admin ACE 是明确的 OS 特权例外，其他 Allow 主体全部拒绝。拒绝空 DACL、不可识别 ACE、reparse point/junction。新临时文件在已验证私有目录内 wx 创建，发布前建立/验证 ACL；不对既有不安全文件做修复。
3. launcher 内部 helper 供 patch、noPet descriptor 与 stop reader 使用。Pet 带自己可独立发布的本地 helper，遵守相同 spec，通过跨生产者的原生 contract test 防止漂移；不让独立 npm 包导入仓库 scripts、不新增发布依赖或改职责。保持同步 patch API、异步 Pet API 的签名和所有 wire 字段。
4. POSIX 分支保持已有 UID、mode、symlink、size、open/fstat 和安全 replacement/boot cleanup 检查。Windows 读方对 run/私有目录/文件批量校验，保留文件句柄身份检查，不把 ACL 错误当作缺失凭据。Pet release 在读取 bootId/删除前也验证私有边界。
5. 在 Windows root test selector 中明确运行 native ACL contract suite，并构建直接调用 Pet producer 所需的产物。真实 Everyone/AuthenticatedUsers 显式和继承权限、run mutation、junction、工具失败均需要负例；仅 mock mode 不构成 Windows 证据。

## Risks / Trade-offs

- PowerShell 冷启动可能耗尽 lifecycle/prepare budget → 批量校验、保持既有总预算并以两条原生 Windows CI 实测；若确需内部等待调整，必须基于证据而非全局扩大测试超时。
- 既有 Windows 缓存 ACL 不安全 → 拒绝，不静默修复/删除。只证明安全的新缓存和既有私有缓存可用。
- 两份独立打包 helper 的漂移 → 同一数值 SID/ACL 契约和原生跨生产者读写测试；不通过新依赖引入更大发布协调。
- 发布中的路径变化 → 保留既有 lstat/文件句柄身份及私有父目录边界，不跟随 reparse；未知实体安全失败。

## Migration Plan

仅在 ticket 分支提交源码和规范。由原生 CI 验证后交付；不运行实际部署。回滚代码即可恢复先前的 fail-closed Windows 不可用状态，安全的私有目录可保留。Pet 行为修复按仓库约定更新 package/manifest 版本及根 lock，不改变 DSH runtime pin。

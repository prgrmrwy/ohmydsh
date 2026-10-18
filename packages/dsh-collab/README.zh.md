# DSH 会话协作

[English](README.md) · 简体中文

<!-- problem -->
同一Host中的独立会话可以在不同仓库工作，但需要一份权威共享台账和定向下一回合通知。本bundle把宿主明确许可的已有会话接入独立协作内核，不把一级会话改造成团队，不创建子会话。默认禁用，必须由受信宿主显式配置。

## 配置

只在目标profile登记bundle，再覆盖默认disabled组合行，明确绝对dataDir、完整allowedSessionIds与disabled:false。manifest仍默认禁用，部署必须由你另行选择。不能从会话环境变量选存储位置。

```yaml
- override:
    dsh-collab:
      disabled: false
      config:
        dataDir: /absolute/profile-owned-state/collab
        allowedSessionIds: [complete-session-id-a, complete-session-id-b]
```

数据目录不能在任何声明workspace或node_modules部署目录内。新目录0700；既有目录若group/other可访问则拒绝，不偷偷改权限。同目录不能有两个Host写入。serviceId由canonical dataDir摘要稳定派生。构建内联当前内核源码，运行不依赖workspace内核包。

许可名单是人的接入选择，**不是自动证明会话不受其它产品管理**。只加入独立普通会话；已知subagent origin/depth和官方所有权错误拒绝。普通fork不因parent lineage单独拒绝。不读Pet或Agent Teams私表。

## 工具与信任

15个具名内核写适配、4个授权读工具和collab_sessions。先通过collab_read_convention读版本约定，再用overview/read_since继续工作。写命令要求稳定非空cmdId，同一成功命令重试返回原收据；成员名字遵循内核小写规则。邀请不自动join或授予读取权。

身份仅取真实exec.agent，参数不能提供principal/actor/provider或调用者会话。发现只给许可元数据，不读消息。通知只带白名单指针和插件来源，不带业务正文/标题，不授予用户或workspace权限。忙碌会话followup进入下一回合，不steer当前回合。

成功投递仅表示**Host接受入队**，不表示落盘、模型完成或用户同意。入队到session flush间崩溃可能丢指针；未知/失败不自动重发，台账仍是真源。没有人类确认或breaker reset模型工具；纯agent空间请求决定返回COLLAB_NO_DECIDER，合法历史human无确认通道保持等待。

## 离线残锁维护

先停止该目录的**全部Host**并阻止并发启动，再由操作者用精确实例ID执行：

```sh
dsh-collab-unlock --data-dir /absolute/profile-owned-state/collab --space-id SPACE --expected-instance-id INSTANCE --all-hosts-stopped
```

只有正安全PID的本机进程探测返回ESRCH才可恢复。活进程、EPERM、未知、PID重用、坏锁、身份改变都拒绝。命令不open或重写日志。这是受信单操作者停机流程，不是对并发writer的原子CAS；不暴露给agent、不绕过活writer。正常关停排空已接纳存储，但官方CLI有限总预算也可能残锁，SIGKILL同样如此。

## 验证

见[隔离测试说明](test/README.zh.md)。仅临时home、合成会话和本地脚本模型，正常停止、预算耗尽和SIGKILL分别验证；组件通过不等于全部consumer场景完成。不修改日常profile/GUI。

## 移除
<!-- section: removal -->
本插件连接普通DSH会话执行与独立协作内核。不再需要时禁用/移除bundle及manifest项，再按另行授权构建/重启。dispose撤销工具并关闭已接纳存储，保留协作日志；不删除workspace或会话数据。独立内核仍可单独使用和移除。

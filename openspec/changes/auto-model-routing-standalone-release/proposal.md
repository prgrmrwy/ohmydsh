## Why

auto-model-routing 目前只能按 ohmydsh 内部安装说明使用，配套 skill 也在包外；独立用户无法通过一次插件安装获得完整能力。沿用 sidebar-session-provider-icon 的 subtree 镜像发布方式，将源码、构建、skill 与安装文档组织成可独立分发的 0.3.0，并接入 npm 与社区商店。

## What Changes

- ohmydsh 继续作为唯一源码真源，公开镜像目标为 `prgrmrwy/dsh-auto-model-routing`；不采用 submodule，不把 manifest 改成 remote。
- **BREAKING（部署接线）**：把 `subagent-model-routing` skill 移入插件包，由 bundle 自带 filesystem provider 注册；移除独立 skill customization，清理 sync 曾管理的旧部署副本。插件与 skill 同启停，不再保留独立 skill 开关。
- 发布版本 0.3.0：移除 private 标记，补许可证、发布元数据、prepare/prepack、打包文件、截图清单及 OIDC release workflow。
- 保留精简双语 README 和 GIF，改为独立安装视角；跨仓规范链接使用绝对 URL。明确 Jev 出站、凭据与状态存储，以及 skill 是尽力指引而非强制派发拦截。
- 通过隔离安装和真实 Host skill catalog 验证后，提交源码、创建公开镜像、发布 npm、申请 awesome-dsh-plugin 与 dsh.so 收录；区分“已提交申请”和“已上架”。
- 不改变判档规则、映射算法、默认 MANUAL、外发范围或凭据优先级，不重启日常 GUI。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `auto-model-routing`：插件安装自包含交付配套 skill，迁移旧受管副本且不重复注册；提供独立 npm/Git 分发及可验证的版本化发布约束。

## Impact

- `packages/auto-model-routing/`：bundle patch、包元数据、包内 skills、发布 workflow、文档和测试。
- `skills/subagent-model-routing/`、`dsh.yaml`、双语根 README、根 lockfile、sync/内容断言测试与主规范中的路径引用。
- 官方 `dsh-skill-filesystem` 依赖声明、scope 可见性及真实 catalog 验证；不扩大宿主权限，不注入全局强制委派指令。
- 外部副作用：公开 GitHub 镜像、npm 0.3.0、商店 PR、dsh.so 申请。执行时复核名称、分类和准入规则；npm 认证由用户在本机安全配置，不通过聊天或仓库传递 token。
- 依赖外部条件：商店仓库年龄门槛（按创建时间计算，而非固定“第二天”）、npm 账号权限与首次发布/Trusted Publisher 绑定、第三方审核与探测延迟。未满足时任务保留未完成，不伪报发布成功。

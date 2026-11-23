## Why

命名空间下会积累不再使用的库：早先派生出来的、试过又放弃的、或者改名后留下的旧目录。页面目前只能
**声明**它们（纳入配置），没有任何移除途径；用户只能去文件管理器里 `rm -rf`，而那里既没有「这个目录
属于哪个库、里面有多少卡片」的上下文，也没有任何保护。

## What Changes

- **「未在配置中的库」清单新增删除动作**：每行除「声明」外提供「删除」；点击后先进入确认态，确认行
  显示**绝对路径**与其中的卡片数，再点「确认删除」才真正删除。
- **删除由宿主执行并严格限定范围**：只接受「命名空间下、有 cards、且没有任何配置条目声明」的**发现型库**，
  且其 home 必须恰好是 `<namespace>/<名字>`；配置声明过的库、派生/本地派生的路由、不在命名空间内的路径、
  以及仍被其它 scope 解析到的目录一律拒绝，并给出原因。页面不能指定任意路径。
- **失败不影响其它数据**：删除失败返回原因，页面只提示，不重试、不回滚其它状态。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `dsh-memex-settings-ui`：「未声明的库可见且可声明」新增删除动作与确认要求、宿主侧的拒绝条件。

## Impact

- `packages/dsh-memex/src/contract.ts`（`delete` 端点与请求/结果类型）、
  `src/host/channel.ts`（`runDelete` 的四道证明）、`src/client/page.tsx`（删除按钮、确认行、`runDelete`）、
  `src/client/locales.ts`、`src/client/styles.ts`，以及 `test/channel-delete.test.ts`。
- 版本：`dsh-memex` 0.4.6 → 0.4.7，`dsh.yaml` 与 CHANGELOG 同步。
- 不影响：声明的库、库间迁移、远端动作与守门。

## Why

dsh-collab 已在公开 manifest 中 `enabled: true`，但插件仍离不开私有 overlay：包自带的组合补丁以 `disabled: true` 插入自己的行，且 `dataDir` 是必填的绝对路径。overlay 因此写死了一台机器的路径 `/Users/prgrmrwy/.dsh/plugins/dsh-collab`。私有 overlay 按约定由所有机器共用，另一台机器（用户 `bytedance`）启动时报 `EACCES: permission denied, mkdir '/Users/prgrmrwy'`，插件未注册任何工具。

## What Changes

- `dataDir` 改为可选：缺省时使用 `<DSH home>/plugins/dsh-collab`。DSH home 按官方 `@deepseek-ai/dsh-home-paths` 的规则取 Host 进程环境中的非空 `DSH_HOME`，缺省为 `~/.dsh`，与 dsh-pet 的状态目录约定一致。显式给出时仍须为绝对路径且优先使用；两种情况都经过原有的 workspace/node_modules 围栏与 0700 校验。
- 包自带的 `cordis.patch.yml` 不再插入 `disabled: true`：只要 profile 登记了 bundle 就加载，启用与否完全由 manifest 的 `enabled` 决定。
- 私有 overlay 删去 `dataDir` 与 `disabled: false`，只保留可选的排除名单。另一台机器 pull 后执行 `dsh build` 与 `dsh restart` 即可使用。
- 规范 `验收不触碰日常会话与部署` 中"插件登记默认 disabled"一句已与实际不符，改为"由 manifest 的 enabled 决定"。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-collab`：`profile共享台账与生命周期封禁`（默认数据目录、包不自带禁用行）、`验收不触碰日常会话与部署`（启用由 manifest 决定）。

## Impact

- `packages/dsh-collab/src/{config,index}.ts`、`cordis.patch.yml`、双语 README 及测试。
- 本机实际数据目录不变（`~/.dsh/plugins/dsh-collab`），serviceId 不变；需要 `dsh build` 与 `dsh restart` 加载新代码。
- inner-ohmydsh 的 `patches/dsh-collab-local.yml` 去掉本机路径。

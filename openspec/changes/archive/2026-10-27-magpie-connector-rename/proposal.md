## Why

自研 Magpie 插件名 `dsh-magpie` 与上游第三方 `dsh-magpie-connect` 容易混淆，且插件已具备独立发布条件。用户要求把插件名改为 `dsh-magpie-connector`，并同步把 route id 一起改名；同时按 AUTO 插件的消费面呈现方式重做 README（设置页与选择器交互 GIF、archify 架构图、基础/特色功能说明）。

## What Changes

- 插件 package/npm 名、Cordis id、LLM route、API 路径、设置目录从 `dsh-magpie` 全量改为 `dsh-magpie-connector`；凭据引用不变。
- 新增一次性只读迁移：新设置文件不存在时读取旧 `plugins/dsh-magpie/settings.json`，不改写、不删除旧文件。
- 同步依赖真实 route id 的 AUTO 策略 transport、出口守卫豁免 patch 与测试、侧边栏品牌回归用例、根 README 索引与 manifest 条目。
- 更新当前 specs；README 双语重写为消费面视角，新增隔离宿主录制的选择器/设置页 GIF 与 archify 架构图，欢迎 issue/PR。
- 发布准备：npm 元数据、screenshots.json、独立镜像仓库视角的双语 README。

## Capabilities

### New Capabilities
无。

### Modified Capabilities
- `dsh-magpie-connector`：新增「插件身份与命名」要求，含旧设置只读迁移与依赖方 route id 同步。
- `auto-model-routing`、`home-network-model-guard`、`sidebar-session-provider-icon`：把引用的 Magpie route id 更新为 `dsh-magpie-connector`。

## Impact

代码与测试：`packages/dsh-magpie-connector/`（原 `packages/dsh-magpie/`）、`packages/auto-model-routing/src/policy-v2.ts` 与其测试、`packages/home-network-model-guard/` patch/测试、`packages/sidebar-session-provider-icon/test/logos.test.ts`。文档：双语 README、`docs/SCREENSHOTS.md`、`docs/architecture.{zh,en}.{svg,json}`。清单：`dsh.yaml`、`patches/home-network-model-guard-config.yml`、根 README 索引。发布：GitHub 镜像仓库 + npm 包，需用户完成 npm 登录后由发布流程执行。

兼容性：旧 `dsh-magpie` route 不再注册，旧会话需手动重选模型；凭据与旧设置文件保留。

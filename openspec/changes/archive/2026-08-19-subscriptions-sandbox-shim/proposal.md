# Proposal: subscriptions-sandbox-shim

## Why

`dsh-plugin-subscriptions` 把 ChatGPT(Codex)/Grok 订阅接进 DSH 主对话后,GPT/Codex 系模型在调用 `bash`/`write`/`edit` 等工具时,倾向主动填写 schema 中广告的 `sandbox_permissions`/`justification` 两个可选参数,而 DSH core 在**组合期**静态广告这两个字段、却在**执行期**才按会话 standing mode 做严格更宽检查(见 BACKLOG D001 与 [upstream issue #7](https://github.com/V1ki/dsh-plugin-subscriptions/issues/7),rc.7 未修)。当前部署是 `danger-full-access` + `approval: never`,任何携带这两个字段的调用都必然失败(`not strictly wider`,且 approval 永远不可用),会话里反复出现 GPT 连踩 10+ 次的工具调用失败。DeepSeek 模型对可选参数保守、通常省略,所以不受影响;但 schema 对两类 provider 逐字节相同,这不是 provider 差异,是模型行为差异。需要一个不改 DSH 源码、不影响 DeepSeek 的临时稳定方案。

## What Changes

- 新增自研 local 插件包 `packages/dsh-subscriptions-sandbox-shim/`(bundle 标准,manifest 条目 `subscriptions-sandbox-shim`,`source: local`),在 **llm 适配器边界**对订阅 provider 的工具面做两层清洗:
  - **出站(schema 层)**:发给模型的工具 `parameters` 中删除 `sandbox_permissions`/`justification` 两个属性,从源头消除模型误填的诱因;
  - **入站(返回参数层)**:对模型返回的工具调用 `arguments` 做 JSON 解析并删除这两个键(解析失败原样透传),作为硬保证——即使模型仍幻觉出这两个参数也不会导致工具调用失败。
- 作用范围按 provider 路由配置,默认 `['codex', 'grok']`(Responses 系);`claude` 可配置加入;DeepSeek 原生 provider 完全不受影响。
- 不改 DSH 源码、不 fork 不 vendor `dsh-plugin-subscriptions`、不改会话权限/审批状态。
- 更新 `BACKLOG.md` 的 D001 条目与 `dsh-sandbox-notes` skill 的关联说明(可选,记录 shim 作为该缺陷的部署侧缓解)。

## Capabilities

### New Capabilities

- `subscriptions-sandbox-shim`: 订阅 provider(默认 codex/grok)的 LLM 工具面 sandbox 升级字段清洗契约——出站 schema 剥离、入站 arguments 剥离、provider 路由配置、对非目标 provider 零影响。

### Modified Capabilities

- (无——`repo-layout` 只规定定制单元形态,本 change 是它的实例,不改变其需求。)

## Impact

- **仓库文件**:新增 `packages/dsh-subscriptions-sandbox-shim/`(package.json + cordis.patch.yml + src/ + CHANGELOG.md);`dsh.yaml` 新增一条 `source: local` 定制;`BACKLOG.md` D001 条目补记 shim 缓解。
- **部署面**:sync 后 `~/.dsh/profiles/web` 安装该 bundle 插件,重启 `dsh web` 生效;`dsh-plugin-subscriptions` 本体零改动(仍按 `remote` pin 0.3.1)。
- **行为边界**(需在设计里明确并写进文档):
  - 在受限会话(`read-only`/`workspace-write` + `approval: ask`)里,本 shim 会同时剥掉**合法**的升级通道——该部署形态下必须禁用本定制;
  - 本 shim 是 D001 缺陷的部署侧缓解,上游修复后应移除。
- **风险**:对 `ctx.llm.adapters` 注册表的适配器实例做包装属 DSH 内部面,DSH 升级后需回归验证;上游插件更新后需确认 provider 路由与 chunk 形状不变。

# 已撤回的 session-links 配置编辑实验（非当前实现）

> **范围纠正**：该实验在 `e042a47` 被撤回，`131d626` 只保留对应文档历史。用户最终要求 session-links 仅做 0.2 窄兼容，不新增 Config/设置编辑能力。下文 RED/GREEN 和 Host namespace 结果仅属于已撤回的实验，不是当前 candidate 验收结果，也不要求重新实现该面；tasks 3.8 和 design D3 已修正。

## 缺口（上一轮确认）

0.2 真实 Host 的 `settings/describe` 无 session-links namespace，普通 Settings 也无表单；源码 host 侧只在 `apply` 里从 loader row config 一次性 `parseLinkRules`，既没有导出 Schemastery `Config`，也没有运行中更新与缓存失效语义。官方 settings-provider 要求 `entry.fiber.runtime.Config` 存在且字段 `.volatile()`（`schema()` 与 `volatileForm` 检查），否则报 `No configurable plugin entry`。因此 3.8 的“session-links 实际设置编辑成功”当时无入口。

用户裁定：在既有 change 范围内补齐官方配置编辑能力。

## 实现（真实行为，非仅文档）

- 新增 `packages/session-links/src/config.ts`：导出 `Config = Schema.object({trackerHosts, reviewHosts})`，两者 `Schema.array(Schema.string()).default([]).volatile()`，并提供 `parseLinkConfig`。
- `src/shared/links.ts`：`parseLinkRules` 通过结构化 `Ref<T>`/`isRef` 读取稳定引用，同时兼容内联数组（旧 row config 与测试）；不可用条目仍按既有文档语义归一化丢弃。
- `src/index.ts`：`apply(ctx, config = parseLinkConfig({}))`；规则改为每请求 `currentRules()` 活读，不再在 mount 时捕获；缓存条目增加 `rulesKey`，规则变化时必然 miss，避免设置保存后在 TTL 内继续返回旧分类。
- `package.json`：新增运行时依赖 `@deepseek-ai/schemastery ^3.18.2`（与 dsh-memex 同款放置）。

非法值语义：类型/形状由 loader 校验，拒绝时保留运行中 last-good 引用；单条目合法性仍由 `parseLinkRules` 归一化。

## RED → GREEN

在 devbox 83c69cf 精确仓库上应用改动，先只保留新 `config.ts` 并把 `index.ts`/`shared/links.ts` 回退到 83c69cf：新增 `test/config.test.ts` 中 schema 3 项通过，两项行为断言失败（`expected [] to deeply equal [ 'first.example.com' ]`），即旧代码在 mount 时捕获规则且不认识引用。

恢复完整实现后包内全量：**6 文件 64 测试通过**，`tsc -p tsconfig.json --noEmit` 通过。

## 真实 Host 可编辑性

构建产物部署到候选 profile（`index.js` 与原构建 `cmp` 一致，含 `currentRules`/`rulesKey`），隔离候选 0.2.0-rc.2 上经真实 `settings/describe`：

```
namespacePresent: true, schemaHasTrackerHosts: true, schemaHasReviewHosts: true,
revision: 0, applies: "live"
```

即原先缺失的官方编辑面已存在，且被官方标记为 live（可热编辑）。

## 未完成

尚未做普通 UI 的“填写→保存→Host 回读→刷新”闭环：本轮 Settings 导航按钮过滤只命中 `Archived sessions`，该 namespace 的界面标签与表单结构未定，因此**不宣称 3.8 的 UI 保存已通过**。下一轮按实际标签定位表单并完成保存/回读/刷新与还原。私有 org 键基线、build×2 后用户值与 org 键共存仍属未完成门禁。

## 环境

devbox 预览仓库测试后已 `git checkout` 还原并 `git status --short` 为空；候选 PID2794879 经身份核验 SIGTERM 正常；生产 3080 仍 PID2004366。未改本机 DSH/VM、正式 pin 或发布；未 push。

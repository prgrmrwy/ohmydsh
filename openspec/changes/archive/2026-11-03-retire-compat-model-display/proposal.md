## Why

Pet compat 运行时里的 `model-display.patch` 重建了五个官方宿主包，给 resolved-model 增加了 `displayGroup` 展示元数据，原本只为 Magpie 在选择器里分组显示。change `magpie-owner-routes` 把 dsh-magpie-connector 改成按网关归属注册多个真实 route，原版选择器就能分组；插件不再输出 `displayGroup`，测试也断言了这一点（`packages/dsh-magpie-connector/test/owner-routes.test.ts:107-117`）。全仓搜索确认，这个 patch 现在没有任何使用方。

按 `pet-compat-minimization` 的「Compat 层 MUST NOT 包含当前未启用的 seam」，它应当移除。留着它的代价是：每次升级 DSH 都要重新推导这五个包，Host launcher 的构建时间和 fingerprint 输入也更多。

## What Changes

- 删除 `packages/dsh-pet/compat/subagent/model-display.patch`、`model-display.package.template.json`、`model-display.vitest.config.mjs`、`verify-model-display.mjs`，以及 `packages/dsh-pet/test/model-display-*` 共五个测试文件。
- `build.mjs` 不再 apply 或还原该 patch，不再运行专用 vitest 和五包 tsc 构建，也不再产出 `model-display-artifacts` 中的这五个包。team-membership 包目前共用这个产物目录，需要保留，并改用不带 model-display 含义的目录名。
- `build-launcher.cjs` 删掉五包 override、hash pin、fingerprint 输入和 verifier 调用；`@deepseek-ai/dsh-llm`、`dsh-api-session-controller`、`dsh-api-remotes`、`dsh-client-ui-model-selection`、`dsh-client-ui-commands` 改由官方 `@deepseek-ai/dsh@0.2.0-rc.2` 的依赖解析。
- compat README（中英双语）删去 model-display 章节，更新 overlay 包清单与 fingerprint 输入说明。
- 可见行为变化：选择器的搜索不再匹配组标签（`searchText`），只按官方规则匹配模型名；分组仍按真实 route 显示。Magpie 原生分组、AUTO 的单值 effort 显示都不受影响。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-model-routing`：「选择器恢复官方单值 effort」不再要求受管宿主保留展示分组、组标签搜索和 metadata 校验/detach，只保留单值 effort 与真实 provider/model 提交。
- `dsh-magpie-connector`：删除已无使用方的「选择器按网关归属展示分组（AMD2）」旧要求，与已运行的多 route 实现及本次补丁退役一致。

## Impact

- 代码：`packages/dsh-pet/compat/subagent/{build.mjs,build-launcher.cjs,README.md,README.zh.md}` 及上面列出的删除文件；`packages/dsh-pet/test/` 下的 model-display 测试，以及 `team-membership-builder.test.cjs` 的标记断言（仓库级 `tests/` 没有引用它）。
- 运行时：Host launcher 的 fingerprint 会变化，下次 Host 启动时重建 launcher。在用户重启之前，运行中的 Host 不受影响。
- 依赖：多 route 实现须已部署且不再产生 displayGroup；当前源码、运行图和 GUI 均已验证。本 change 同步删除 AMD2 旧要求，独立归档；不连带完成 `magpie-owner-routes` 的发布任务或归档它。
- 不涉及：`team-membership.patch`。它修的是 Team 在 descriptor 写入前误判 one-shot 子会话的通用问题，不属于本 change，另行决定。

## Context

`model-display.patch`（pin `639ed015`，SHA-256 `7ac67eab…`）补了五个官方包：`dsh-llm`、`dsh-api-session-controller`、`dsh-api-remotes`、`dsh-client-ui-model-selection`、`dsh-client-ui-commands`。它新增了可选的 `displayGroup` 字段，覆盖校验与 detach、Host catalog 投影和生成的 Remote codec，同时让选择器和 `/model` 共用展示分组与 `searchText` 搜索。唯一的使用方 dsh-magpie-connector 已在 0.3.0（change `magpie-owner-routes` D10）改为按归属注册多个真实 route，不再输出 `displayGroup`。

接线点：
- `build.mjs`：hash 校验（`:99`、`:133-134`）、cache 指纹（`:180`）、apply/check（`:189`、`:202`）、exit hook 反向 apply（`:225`）、专用 vitest 与上游包测试（`:251-252`）、五包 client tsc/tsdown（`:259-263`）、产物目录 `agent-artifacts/model-display-artifacts`（`:387-404`）。team-membership 包也写进这个目录。
- `build-launcher.cjs`：hash/template 常量（`:47-48`）、已发布 launcher 的自证（`:132-139`，含 `verify-model-display.mjs`）、fingerprint（`:231-239`）、staging 复制、依赖与 overrides（`:312-347`、`:412`、`:422`、`:435`）。
- `packages/dsh-pet/test/model-display-{host,react,routing,popup}.spec.*` 与 `model-display-builder.test.cjs`。

## Goals / Non-Goals

**Goals**
- 从 compat 构建链中完整去掉 model-display seam，五个宿主包回到官方 `0.2.0-rc.2` 的解析结果。
- team-membership 的构建、校验与覆盖行为保持不变。

**Non-Goals**
- 不处理 `team-membership.patch` 的去留或归属。
- 不改其他 Pet seam，不改 Magpie、AUTO 或 sidebar-session-provider-icon 的代码。
- 不自动重启 Host；正式重建与重启已在用户后续明确授权下完成，见 verify.md。

## Decisions

### D1 一次性删除整个 seam，不留开关
按 `pet-compat-minimization`「compat 层 MUST NOT 包含当前未启用的 seam」，patch、模板、vitest 配置、verifier 和五个测试一起删除，不保留可选开关。

**移除证据（逐项语义）**：
| 语义 | 现在由谁承担 / 为什么不再需要 |
|---|---|
| resolved-model `displayGroup` 校验/detach | 已没有产生方：connector 测试断言 `listModels`/`resolveModelInfo` 都不含该键（`owner-routes.test.ts:116-117`、`owner-catalog-mapping.test.ts:17`） |
| catalog 投影与 Remote codec 保留字段 | 同上，没有字段需要保留 |
| 选择器按 displayGroup 分桶 | 原版 `buildModelCatalog` 一个 route 一组，connector 已按归属注册 route（magpie-owner-routes D1） |
| `searchText` 组标签搜索 | 接受退化：原版只按模型名、label 和 detail 匹配（见 Risks） |
| AUTO 单值 effort | 原版 `ui-model-selection` 没有 `lastUsed` 双值接缝（在 pin 上执行 `git grep lastUsed HEAD -- packages/client/ui-model-selection/src` 无结果），本来就是单值 |

### D2 team-membership 改用独立产物目录
产物目录从 `model-display-artifacts` 改名为 `team-membership-artifacts`。build 与 launcher 只遍历 `teamMembershipTemplate.packages`，并删除 `artifactTemplate` 和 `template` 的二选一分支。`modelDisplayPackages` 等变量改名为 `hostPackageOverrides`，生成的 `dsh_compat.reason` 只保留 team 的文本。

### D3 exit hook 只靠 checkout 还原
只有 model-display 会新增文件（`display-groups.ts`），所以需要反向 apply。去掉它之后，其余 patch 只修改已跟踪的文件，`git checkout -- .` 就足够。旧缓存里残留的未跟踪文件由 `upstream-cache.cjs` 处理：patch 指纹变化后会先执行 `git clean -ffdx`。

### D4 上游包测试只保留与剩余 patch 相关的部分
删除五包专用 vitest 和 `llm/session-controller/ui-*` 上游测试那一行；保留 continuation 和 Team 两组测试。

## Risks / Trade-offs

- [选择器搜索不再命中组标签] → 例如输入 "magpie" 不再筛出 Magpie 组下的模型。可以接受：模型名本身已包含厂商（如 "Claude Opus"），原版行为就是如此。
- [launcher 重建] → fingerprint 变化，下次 Host 启动时会触发一次完整重建（需要联网，耗时较长）。build 失败时保留旧 `.launcher` 并 fail closed（现有行为）。在验证阶段先用 `--isolated-output` 跑通构建，再交给用户决定何时重启。
- [`magpie-owner-routes` 未归档] → 多 route 实现已部署并通过本次验收，但关联 change 的发布任务尚未结清。本 change 自持 AMD2 旧要求的删除 delta，只同步补丁退役所需的规范变化；不将独立的商店发布或关联 change 整体归档作为前置，也不代为勾选它们的任务。后续合并 `magpie-owner-routes` 时，已经删除的 AMD2 要求按幂等删除处理。

### 收尾依赖修订（2026-11-03）

最初计划将本次归档依赖于整个 `magpie-owner-routes` 的归档。收尾核对后确认，真正必要的前提是多 route 已替代 displayGroup 且不存在补丁消费者；源码、运行图和 GUI 验收已经证明这些事实。独立发布任务不是补丁退役的技术依赖，故以本 change 的 AMD2 删除 delta 解除不必要的串行归档依赖。

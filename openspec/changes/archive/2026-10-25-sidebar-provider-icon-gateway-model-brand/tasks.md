## 1. 判定逻辑

- [x] 1.1 反转 `src/client/logos.ts` 的 `gatewayModelBrandOf`：改为先 `modelBrandOf(斜杠后)`、认不出再 `providerBrandOf(斜杠前)`；同步更新该函数与其上方 `GATEWAY_BRANDS` 的注释，说明「主图表达平台、小图表达模型厂商」。验证：`npm run typecheck` 通过，且文件内不再有「上游段先于模型名」的描述。
- [x] 1.2 确认直连 route 路径未被触碰：`badgeBrands` 中仍以 `GATEWAY_BRANDS.has(route)` 隔离网关解析，非网关 route 继续走 `modelBrandOf(整个 id)`。验证：`opencode-go/deepseek-v4-flash` 与 `traex/GPT-5.6-Sol[1m]` 的既有单测不改一行仍通过。

## 2. 测试

- [x] 2.1 改 `test/logos.test.ts` 网关用例预期：`dsh-magpie-connect / opencode-go/deepseek-v4.1-flash` → `{ primary: 'magpie', secondary: 'deepseek' }`，并保留 `claude/claude-haiku-5-5` → anthropic、`codex/gpt-6-luna` → openai。验证：`npm test` 通过。
- [x] 2.2 新增兜底用例：模型名认不出时退回上游段（`dsh-magpie-connect / opencode-go/private-model` → opencode；`group/deepseek-v4-flash` → deepseek；`auto/claude-haiku-5.5` → anthropic），以及两段都认不出（`custom/omen-alpha` → 仅 magpie）。验证：`npm test` 通过。
- [x] 2.3 新增「小图标不复述平台」断言：`badgeInnerHTML('dsh-magpie-connect', 'opencode-go/deepseek-v4.1-flash')` 含 `data-sub-brand="deepseek"` 且不含 `data-sub-brand="opencode"`。验证：`npm test` 通过。

## 3. 文档与版本

- [x] 3.1 `package.json` 版本 0.1.9 → 0.1.10；`CHANGELOG.md` 新增 0.1.10 段，写明反转原因（小图标改为模型厂商，主图保持网关）与回滚方式。验证：`node -e` 读出版本为 0.1.10。
- [x] 3.2 包内 `README.md` / `README.zh.md`：映射表 Magpie 行改为「Magpie 主图，右下角 DeepSeek / Anthropic / OpenAI」，网关解析段说明改为「先按 `/` 后的模型名，认不出再按上游段」。验证：`grep` 后不再出现「opencode-go` → OpenCode」这类把上游段当小图品牌的说法。
- [x] 3.3 `dsh.yaml`：该条目 `version` → 0.1.10，note 中「Magpie 网关 route 下按上游段识别小图标」改为「Magpie 网关 route 下按模型厂商识别小图标（上游段兜底）」，并在 change 列表附上本次 change 名。验证：`grep` 确认。

## 4. 构建与部署

- [x] 4.1 仓库 `npm test`、`npm run check:artifacts` 通过；包内 `npm test`、`npm run typecheck`、`npm run build` 通过。验证：命令退出码 0。
- [x] 4.2 `node scripts/sync.mjs` 部署，连续运行第二次无变更。验证：第二次输出无 changes。
- [x] 4.3 用本包真实 `badgeInnerHTML` 在 headless Chrome 渲染浅色/深色主题核对：Magpie 会话右下角为 DeepSeek，直连 OpenCode 会话仍为 OpenCode + DeepSeek。验证：截图可辨认。
- [x] 4.4 核对运行时已加载新 bundle（无需重启）。实测：`/plugins/events` SSE 报该插件 `rev=4a376f859f2c`，与磁盘 `lib/client.js` 的 mtime/ctime/size 计算的 rev 完全一致；`curl` 拉取该 rev 的 bundle 已含 `modelBrandOf(...) ?? providerBrandOf(...)`。用户确认改为刷新页面自行核对，不重启承载本会话的 web 进程。
- [x] 4.5 合入主规范并归档 change（`2026-10-25-sidebar-provider-icon-gateway-model-brand`）；提交并推送。

## 实施记录（2026-10-25）

- 1.1 只反转了 `gatewayModelBrandOf` 的兜底顺序，`GATEWAY_BRANDS` 隔离与直连 route 路径未动；`badgeBrands` 原有单测零修改仍通过。
- 2.x 测试 56 → 57 条：网关预期改为 `opencode-go/deepseek-v4.1-flash` → `{magpie, deepseek}`，新增 `opencode-go/private-model` → opencode 的上游段兜底，以及 `data-sub-brand` 不含 `opencode` 的断言。
- 3.3 `dsh.yaml` note 首次改写后为 647 码点，触发 `repo-docs-governance` 的 ≤600 限制（同一提交前为 587），已精简至 573 码点后通过。
- 4.1 仓库 `npm test` 为 574 pass / 2 fail。其中 `every enabled customization has a brief ≤80 and note ≤600` 由本次 note 超长引起，已修复；`every repo-relative markdown link resolves to a tracked path` 在**未改动的基线上同样失败**（`git stash` 前后逐条比对一致，失败项全部来自既有 `openspec/changes/add-dsh-magpie-plugin/` 的 review 文档），与本 change 无关。
- 4.4 关键发现：本插件的 client bundle 由 `client-hmr` 每 500ms stat 轮询并在 rev 变化时推送，宿主会重新读取磁盘上的 bundle，因此**重建后无需重启 web 进程**，刷新页面即可生效。这一点改变了「必须重启」的初始假设。


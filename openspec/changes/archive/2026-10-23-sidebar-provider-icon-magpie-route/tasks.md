## 1. 品牌资产

- [x] 1.1 从 `https://raw.githubusercontent.com/yetone/magpie/ba1dc7f975666e50308ef7bf8173c8a8e91c553b/internal/provider/magpie.svg` 下载落盘为 `packages/sidebar-session-provider-icon/src/client/assets/magpie.svg`，校验 SHA-256 = `988d2e57b6b87043776521220c82e6f4cdbff0a7d2785ee9416321a918ec0138`
- [x] 1.2 `src/client/assets/README.md` / `README.zh.md` 增加出处行（URL、commit pin、MIT、SHA-256）
- [x] 1.3 `THIRD-PARTY-NOTICES.md` 增加 magpie 段（MIT 全文，Copyright (c) 2026 yetone），并在 Rendering notes 中记录"仅 magpie 根元素注入 `fill="currentColor"`"

## 2. 判定与渲染

- [x] 2.1 `logos.ts` 新增 `magpie` 品牌键与资产导入
- [x] 2.2 `providerBrandOf` 在包含式规则之前加入 `route === 'magpie' || route.startsWith('magpie-')`
- [x] 2.3 `badgeBrands` 对网关型 route（`magpie`）按"上游段 `providerBrandOf` → `/` 后 `modelBrandOf`"决定 model 品牌；其它 route 行为不变
- [x] 2.4 `sizedSvg` 只对 magpie 资产在根元素注入 `fill="currentColor"`（资产文件不改）

## 3. 测试

- [x] 3.1 `test/logos.test.ts`：`dsh-magpie-connect`、`magpie`、`magpie-home` → magpie；`not-magpie` 不识别为 magpie
- [x] 3.2 复合：`dsh-magpie-connect / claude/claude-haiku-5-5` → magpie + anthropic；`codex/gpt-6-luna` → magpie + openai；`opencode-go/deepseek-v4-flash` → magpie + opencode；`auto/claude-haiku-5.5` → magpie + anthropic；`group/deepseek-v4-flash` → magpie + deepseek；`custom/omen-alpha` → 仅 magpie
- [x] 3.3 回归：`openrouter`、`traex`、`opencode-go` 等现有 route 的 primary/secondary 不变（现有用例全部通过）
- [x] 3.4 渲染：magpie 输出含 `fill="currentColor"`，其它品牌输出不含新增 fill；无外部 URL
- [x] 3.5 `npm run typecheck`、`npm test`、`npm run build` 通过

## 4. 发布与部署

- [x] 4.1 版本 0.1.8 → 0.1.9：`package.json`、CHANGELOG、`dsh.yaml`（version 与 note 的 change 名）；包 README / README.zh 的映射表加 Magpie
- [x] 4.2 仓库 `npm test`、`npm run check:artifacts` 通过；`node scripts/sync.mjs` 部署，第二次运行无变化
- [x] 4.3 刷新 http://127.0.0.1:3080，用真实 Magpie 会话核对：Magpie 主图在深浅主题下都可辨认，右下角显示上游品牌；直连会话不变
- [x] 4.4 合入主规范并归档 change；提交并推送

## 实施记录（2026-10-23）

- 3.2 实施中修正一条预期：`openrouter/anthropic/claude-haiku-5.5` 的子图标是 Anthropic，不是 OpenRouter。原因是 OpenRouter 在本插件里只是 model 维度品牌（`openrouter-*`），不是 route 品牌，所以上游段识别不出，回落到 `/` 之后的模型名。这符合 D3。
- 测试环境：Vite 默认 4 KB 内联上限会把约 4.9 KB 的 magpie.svg 变成 URL 字符串，vitest 下拿不到 markup，所以 `vitest.config.ts` 把 `build.assetsInlineLimit` 设为 16 KB；生产用的 tsdown text loader 不受影响。
- 验证：包内 vitest 56/56、typecheck、build 通过，bundle 中除 w3.org 命名空间外没有外部 URL。仓库 `npm test` 为 444 pass / 1 fail，失败项是 origin/main 上已有的 `collab-ref-threads` 链接问题，与本 change 无关（逐条比对，没有新增的失败链接）；`check:artifacts` 通过。`sync.mjs` 部署 5 处变更，第二次运行无变化；部署产物与构建产物逐字节一致。
- 4.3 部分：用本包真实的 `badgeInnerHTML` 输出在 headless Chrome 中按浅色和深色主题各渲染一次。Magpie 主图在两种主题下都可见，右下角分别为 Anthropic、OpenAI、OpenCode；`custom/omen-alpha` 只显示 Magpie；直连 `claude`、`opencode-go` 不变。2026-10-23 用户在真实 DSH 页面（http://127.0.0.1:3080）刷新后确认：Magpie 会话图标显示正确。

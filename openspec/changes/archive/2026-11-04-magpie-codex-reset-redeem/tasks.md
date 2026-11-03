## 1. Host：传输与投影

- [x] 1.1 `src/host/transport.ts`：白名单加 `POST /magpie/quotas/codex-reset`；query 规则改为按路径的允许/必需 key（refresh：`provider|user` 可选；codex-reset：`user`、`credit` 必需且仅此两项）；补 `test/transport.test.ts` 的「重置端点的 query 受限」场景
- [x] 1.2 `src/host/cards.ts`：投影时把 `resets.each[].id` 抽到 host 内部 `State.credits`（按 `provider\0user`），浏览器投影不变，另加 `resets.redeemable`（codex、有 user、非 byWindow、至少一张带 id）；暴露给重置控制器的单卡强制刷新方法（复用 refresh gate）；更新「重置卡投影只保留固定字段」与「没有 id 的旧网关」测试

## 2. Host：重置控制器

- [x] 2.1 新建 `src/host/reset.ts`：共享门槛常量 80 与纯函数 `eligibility(card, credits, now)`（周窗口 `7 days`、`resetsAt` 在未来、无 `error`、选最早到期且未过期的带 id 重置卡）
- [x] 2.2 `ResetController.prepare/consume`：单票据 60s 一次性、全局 busy、按账号的 uncertain 锁；consume 时再刷新、再校验、确认票据中的 credit 仍在；`POST codex-reset?user=&credit=`，45s 超时；2xx+code / 4xx / 其它 三类结果；成功后单卡刷新；错误脱敏
- [x] 2.3 `src/host/routes.ts` 注册 `reset` 资源（只 POST，body 形状校验，400 拒绝其它）
- [x] 2.4 测试 `test/reset-redeem.test.ts`：门槛未达、两段确认成功（网关只收到 `credit=r1` 且浏览器响应无 id）、票据一次性/过期、所选卡已不在、全局单飞、不确定锁定、4xx 不锁、`nothing_to_reset`

## 3. Client

- [x] 3.1 `src/client/api.ts`：新增 `reset` 资源；consume 超时 60s，浏览器超时按「结果不确定」提示
- [x] 3.2 `src/client/view-model.ts`：`CardResets.redeemable`；浏览器侧预判 `resetBlock(card, now)`（复用 80 常量）
- [x] 3.3 `src/client/UsageCard.ts`：箭头换 12px SVG、gap 6、条目缩进 18、行高 28；最早到期项上的「使用…」按钮（`aria-disabled` + `title` 原因）；卡片内 `role="status"` 结果行
- [x] 3.4 `src/client/SettingsPage.ts`：确认 `<dialog>`（账号、周用量、到期时间、警告、勾选框、取消/消耗一次重置），调用 prepare/consume，结果写回卡片并用刷新响应更新
- [x] 3.5 `src/client/locales.ts`：zh/en 文案（使用…、正在检查…、门槛/刷新提示、确认标题、警告、勾选、确认按钮、各 `code` 结果、不确定、已有重置正在进行、票据过期、所选重置已不可用）；`test/client-locales.test.ts` 通过
- [x] 3.6 `src/client/styles.ts` 对应样式；`test/cards-render.test.tsx` 增「只在最早到期那张上显示按钮」「周用量未达门槛」「展开条目与标题对齐」，并把旧的「没有与重置关联的按钮」断言改为「无 id 时没有按钮」

## 4. 文档与发布

- [x] 4.1 `package.json` 升到 0.6.3；CHANGELOG、README.md / README.zh.md 更新「只读用量卡片」行与安全说明（含入口白名单需放行 `codex-reset` 的部署提示）
- [x] 4.2 `dsh.yaml` 条目说明补 0.6.3；`openspec/specs` 同步由归档完成

## 5. 验证

- [x] 5.1 包内 `typecheck`、`test`、`build` 全过；仓库 `npm test`、`npm run check:artifacts`
- [ ] 5.2 预览环境验收（`dsh build` → `ws prepare-preview` → `dsh`）：确认对齐效果；周用量 < 80% 时按钮禁用且提示正确；不在真实账号上消耗重置卡，除非用户明确要求
  - 未做：本会话 shell 没有 `WS_*` 变量，`dsh build` 解析到主 checkout（仍是 0.6.2，生产未变），`ws prepare-preview` 因此报「先跑 dsh build」。
  - 2026-11-04 用户决定：以单测（包内 514 全过）为准直接合入，跳过预览验收；真机使用与消耗重置卡的冒烟留待用户后续自行验证。
- [x] 5.3 `openspec validate magpie-codex-reset-redeem --strict`

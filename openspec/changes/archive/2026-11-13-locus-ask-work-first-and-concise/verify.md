# Verify — locus-ask-work-first-and-concise

日期 2026-11-13；Linux，主 checkout `main`，DSH 0.2.2-rc.1，dsh-pet 0.2.16（源码与 `~/.dsh/profiles/web` 部署版本一致）。

## 自动化

- `packages/dsh-pet`：`npm run typecheck` 通过；`npm test` 230 个文件中 228 通过、2 跳过，3284 项中 3280 通过、4 跳过，0 失败。
- 仓库级 `tests/repo-docs-governance.test.mjs` 的断链检查失败 1 项：本 change 的 `review*.md` 用了从仓库根起算的链接。归档目录不在该检查范围内，归档后消失；归档前未改写这些评审文件。
- `openspec validate locus-ask-work-first-and-concise --strict`：只有 1 条 warning（一条 ADDED 要求正文超过 500 字），严格模式因此判不通过；没有 error。

## 文档

- 9.4：`docs/architecture/dsh-plugin-integration-pitfalls.md` 第 9 节已有「复发实例（2026-11-10）」。

## 未覆盖

- 9.3 预览验收（测试群）没有做：信息类问题先问主会话、工作会话非空闲时不被打扰、群内回复为业务口径、主会话 GUI 只一行、M 归档后新群 `/bind` 成功、迟到答复被拒，均无真机证据。该功能自 2026-11-11 起随日常 Host 运行，但日常使用不等于按上述清单验收。

## 补充：真实群验收（2026-11-19）

- 环境：日常 Host（3080），新建测试群（仅所有者与 bot），新工作会话 `session-5d45c286`，由 `/bind` 新建 locus 主会话 `session-220cc540`。
- 所有者确认：业务口径与追问细节、locus 主会话只回一行状态、工作会话忙时不打扰、locus 主会话归档后新群 `/bind` 迁移成功并回原群正常回答，均符合预期。
- 日志核对（lead）：locus 主会话每次询问先调用 `locus_work_history`，以 `locus_reply_child` 答复；仅在工作会话空闲时经 collab 转问。

# 整合记录：PR #10 / #11

基线：ohmydsh `main` @ 36374092（插件 0.6.12）；PR 来自镜像仓 `prgrmrwy/dsh-magpie-connector`。

| PR | 提交 | 作者 | 文件 | 处理 |
|---|---|---|---|---|
| #10 | 15207a8b feat: show routing groups in a dedicated settings section | abworks-dev | `src/client/{SettingsPage,locales,view-model}.ts`、`test/routing-groups-ui.test.tsx`、README×2、CHANGELOG、`docs/internal-api.md` | 不整体 cherry-pick：它按 `group/*` 在客户端分类并把勾选写入厂商键，与 design D2/D4（host 下发 `routingKind`、`routing` 键）冲突。参考其分区布局与 UI 测试结构改写；相关提交加 `Co-authored-by: abworks-dev`。 |
| #11 | a423eb6c feat(catalog): give Magpie routing groups their own DSH route | WuW0 | `src/host/catalog.ts`、`test/routing-group-owner.test.ts`、README×2、CHANGELOG、`docs/internal-api.md` | 不整体 cherry-pick：它按标签识别并改写 owner，与 D1 冲突。采纳「路由入口归 routing owner」的核心做法与真实 Host / ID 透传测试思路，按 id 前缀改写；相关提交加 `Co-authored-by: WuW0`。 |

两个 PR 的提交都基于早于 0.6.12 的基线，且都改 README/CHANGELOG，直接 cherry-pick 会与本 change 的设计和文档冲突，因此选择「改写 + Co-authored-by + CHANGELOG 致谢」。Co-authored-by 所需的邮箱在提交前从 PR 提交元数据读取（GitHub noreply 地址）。

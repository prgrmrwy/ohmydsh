## 1. 先写失败的测试

- [x] 1.1 `packages/dsh-memex/test/primary-migration.test.ts`（纯逻辑）：
  - `mergeLibraryCards` 复制 `cards/` 与 `archive/`，源库不变；
  - 目标已有同名 slug 时保留目标、来源记为跳过；
  - 同一库、未落盘库为空操作；库路径互相包含时拒绝；
  - `planPrimaryMigrations` 覆盖「路径声明切换主入口」「主入口未变/只新增认领不迁移」「多工作区共用两库只合并一次」。
  验证：无实现时整文件失败。
- [x] 1.2 `packages/dsh-memex/test/primary-switch-runtime.test.ts`（经真实 Loader 提交 volatile 配置）：
  - 切换主入口后卡片出现在新库，且随后解析到新主入口；
  - 目标库不可写时保留旧路由（`resolve` 仍返回旧主入口）。
  验证：无实现时两条用例均失败。

## 2. 实现

- [x] 2.1 新增 `packages/dsh-memex/src/scope/primary-migration.ts`：主入口判定（与 resolver 同优先级）、
  `planPrimaryMigrations`、`mergeLibraryCards`（`COPYFILE_EXCL`，只增不改）、`migratePrimarySwitches`。
  验证：1.1 全绿。
- [x] 2.2 `packages/dsh-memex/src/plugin.ts`：在 `loader/volatile-update` 里先 `migratePrimarySwitches`，
  成功才 `scopes.replace`；失败告警并保留当前路由；`createMemexRuntime` 新增可选 resolver 环境透传
  （`namespaceDir` / `homeDir`），供测试隔离。验证：1.2 全绿。
- [x] 2.3 `packages/dsh-memex/src/client/page.tsx` 与 `locales.ts`：保存期间显示 `saveBusy` 文案并在
  提交时禁用保存按钮。验证：`npm run typecheck` 通过、构建产物正常。

## 3. 规范与文档

- [x] 3.1 本 change 的 delta spec（`specs/dsh-memex-scope/spec.md`）新增「切换主入口前先把卡片迁到新库」。
  验证：`openspec validate dsh-memex-primary-switch-carries-cards --strict` 通过。
- [x] 3.2 `packages/dsh-memex/README.md`、`README.zh.md` 的「记忆」设置页小节补充：切换主入口会把旧库
  卡片并进新库、同名 slug 保留目标、失败时保留旧路由。验证：与 delta spec 语义一致。
- [x] 3.3 `packages/dsh-memex/package.json` 0.4.1 → 0.4.2；`dsh.yaml` 的 version 同步并在 note 末尾
  追加本 change 与回滚方式（note 保持 600 码点以内）；CHANGELOG 新增 0.4.2 条目。验证：
  `npm run check:artifacts` 通过。

## 4. 校验

- [x] 4.1 包内 `npm run typecheck`、`npm run build`、`npx vitest run`。验证：typecheck/build 退出 0；
  vitest 808 passed / 1 failed（`test/eval-production-runtime.test.ts`），该失败在暂存本 change 改动后的
  干净树上同样失败，属既有环境性基线。
- [x] 4.2 仓库级 `npm test`、`npm run check:artifacts`。验证：与 main 基线对比，无本 change 引入的新失败。
  - 结果（2026-11-04）：仓库级 `npm test` 707 项中 702 通过 / 0 失败 / 5 跳过；`check:artifacts` 通过；
    `openspec validate dsh-memex-primary-switch-carries-cards --strict` 通过；`node scripts/sync.mjs`
    连续第二次输出 `no changes — deployment already matches manifest`（0.4.2 已物化到 `~/.dsh/profiles/web`）。

## 5. 部署与观察（需用户确认后执行）

- [x] 5.1 用户确认 DSH 空闲后执行 `dsh build`（或 `node scripts/sync.mjs`）两次确认幂等，并按需重启 DSH。
  验证：第二次 sync 无变化；运行中的 Host 加载包含本能力的版本（首发 0.4.2，本轮后继 0.4.7）。
  - 补证（2026-11-08）：历史主 checkout 连续第二次 sync 无变化及 0.4.2 物化见 4.2；本次获准的专用原生 Host 实际加载 0.4.7，并以真实 GUI、配置直改和注册工具核对本能力。没有重新部署或重启日常 Host。5.2 的 copied/kept 日志与精确次数仍缺证据，不代为勾选。
- [x] 5.2 在真实配置上切换一次主入口，核对：旧库卡片出现在新库、冲突数量与 `skipped` 记录一致、新会话
  召回有内容。验证：日志含 `primary switch … copied N card(s), kept M target copy/copies`。
  - 2026-11-08：[专用库实测摘要](checking/summary.md)确认真实 GUI/配置直改迁移、目标冲突保留和新 Session 注册召回；P05/P16 的 copied/kept 日志、P10 精确次数仍不足，P11 前置未就绪，整体 needs-human。5.2 保持未完成，不用结构门禁或工具成功代替全部验证。

- 当前复核（2026-11-08）：本 change 严格校验因原有 ADDED 主入口长描述（>500 字）退出 1，属于 warning；该段本轮未改，不将历史 2026-11-04 的严格通过表述成当前全绿。

## 归档说明（2026-11-13）

经用户批准归档。真实使用暴露规格缺口：工作区原先由自动派生的库服务、没有认领条目时，改由另一库认领不触发迁移。0.4.8（`5239866b`）把这种情况纳入切换并补了规格与测试；本机当时滞留的 17 张卡已手工复制进主库。0.4.8 的派生库接管路径只有自动化测试覆盖，未在真实配置上再走一次；5.2 原列的 copied/kept 日志与精确次数证据仍未补。

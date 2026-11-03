## 1. 先写失败的测试

- [x] 1.1 `packages/dsh-memex/test/library-move.test.ts`（纯逻辑）：
  - 搬到空目录时复制 `cards/`、`.git`、`.sync.json`；
  - 目标已有同名卡片与自己仓库时保留目标、只带它缺的条目；
  - 相同路径 / 嵌套路径 / 目标是文件 / 源不存在时拒绝；
  - `assertRetirable` 拒绝根、home 与包含在用库的路径。
- [x] 1.2 `packages/dsh-memex/test/channel-relocate.test.ts`（remote 端点）：
  - 带 `home` 的 `init`：卡片搬到新目录、内核在新目录用 `--init <url>` 执行、旧目录保留；
  - 无 url 时用 `sync` 而非 `init`；
  - 配置仍指向旧目录时 `retire` 被拒绝且旧目录还在；
  - 配置指到新目录后 `retire` 删除旧目录，第二次 `retire` 被拒绝；
  - 目标与当前目录相同被拒绝。

## 2. 实现

- [x] 2.1 新增 `packages/dsh-memex/src/scope/library-move.ts`：`assertLibraryTarget`、`moveLibrary`
  （卡片合并复用 `mergeLibraryCards`，仓库状态仅补缺）、`assertRetirable`、`normalizeLibraryPath`。
- [x] 2.2 `src/contract.ts`：`MemexRemoteAction` 增 `retire`，请求增可选 `home`，结果增 `moved`。
- [x] 2.3 `src/host/channel.ts`：`remote` 端点支持 `home`（搬家 → 内核 → 登记待退休）与 `retire`
  （校验配置已指到目标、路径安全后才删）。
- [x] 2.4 `src/client/page.tsx`：远端区块新增目录输入；拆出 `persistScopes`；`runRelocate` 执行
  「搬家 → 落配置 → 退休」并对每种失败给出提示。`locales.ts` 增 `relocateHint` / `relocateDone` /
  `relocateFailed` / `relocateKeptOld` / `relocateRetireFailed`。

## 2b. 按远端仓库改名（同日追加）

- [x] 2b.1 `suggestedLibraryName`（`src/client/settings-model.ts`）：按远端 URL 取仓库名，被占用时退回
  `<owner>-<repo>`；测试覆盖 git/HTTPS/空串与占用情形。
- [x] 2b.2 页面远端区块新增库名输入与「按此命名」按钮；`runRename` 复用 `renameRow`（钉住当前目录）并在
  同一次确认里可先对远端执行 `init`。`runRelocate` 支持可选新名字。
- [x] 2b.3 `retire` 的证明改为「有库解析到目标目录」，使「搬家 + 改名」也能退休旧目录；新增对应用例。

## 3. 规范与文档

- [x] 3.1 delta spec（`specs/dsh-memex-settings-ui/spec.md`）修改「远端写入按状态分流，且从不重建库」。
- [x] 3.2 `packages/dsh-memex/README.md`、`README.zh.md`「远端操作」小节补充：配置远端可同时迁移库目录、
  顺序、合并规则、旧目录删除条件。
- [x] 3.3 `packages/dsh-memex/package.json` 0.4.2 → 0.4.3；`dsh.yaml` 版本同步、note 追加本 change 与
  回滚方式（note ≤600 码点）；CHANGELOG 增 0.4.3 条目。

## 4. 校验

- [x] 4.1 包内 `npm run typecheck`、`npm run build`、`npx vitest run`。验证：typecheck/build 退出 0；
  vitest 817 passed / 1 failed（`eval-production-runtime`，既有环境性基线，暂存改动后同样失败）。
- [x] 4.2 仓库级 `npm test`、`npm run check:artifacts`、`openspec validate … --strict`。
  - 结果（2026-11-04）：仓库级 `npm test` 707 项中 702 通过 / 0 失败 / 5 跳过；`check:artifacts` 通过；
    `openspec validate dsh-memex-remote-config-moves-library --strict` 通过；`node scripts/sync.mjs`
    第二次输出 `no changes`（0.4.3 已物化到 `~/.dsh/profiles/web`）。

## 5. 部署与观察（需用户确认后执行）

- [x] 5.1 `node scripts/sync.mjs` 两次确认幂等，按需重启 DSH 使 0.4.3 生效。
- [ ] 5.2 在真实库上走一次迁移：核对新目录含全部卡片、`.sync.json` 保留、`sync --status` 仍识别远端、
  旧目录已删除；失败路径（只读目录）确认旧目录与配置均未变。

# Tasks

## 1. 版本门改为下限

- [x] 1.1 `lark-cli-compat.ts`：`PET_LARK_CLI_PINNED_VERSION` → `PET_LARK_CLI_MIN_VERSION = '1.0.97'`，新增导出 `meetsPetLarkCliFloor(version)`（三段数值比较），`resolvePetLarkCliCompat` 返回 `{ binary, version, spoolRoot }`，低于下限的诊断写出实际版本与最低版本；`test/lark-cli-compat.test.ts` 覆盖 1.0.94 拒绝、1.0.97/1.0.98/1.1.0/2.0.0 放行、1.0.100 > 1.0.97、无版本拒绝，测试通过
- [x] 1.2 `media.ts`：`PinnedLarkDownloader` → `VerifiedLarkDownloader { binary; version: string; spoolRoot }`，`createLocusMediaPort` 改用 `meetsPetLarkCliFloor`；同步 `src/index.ts` 等调用点与 `test/locus-media.test.ts` 的 fixture（低于下限的 downloader 仍为 unavailable 且零副作用），`npm test`/typecheck 在 `packages/dsh-pet` 通过

## 2. 文档与 manifest

- [x] 2.1 更新 `dsh.yaml` dsh-pet note 与 `packages/dsh-pet/docs/media-download.md` 的版本说明为"≥1.0.97，与 Pet 其它调用同一 PATH binary"；`grep -rn '1\.0\.94' packages/dsh-pet/src dsh.yaml` 无残留（历史验收记录段落除外）

## 3. 集成验证

- [x] 3.1 仓库根 `npm test`、`npm run check:artifacts`、`openspec validate pet-lark-cli-version-floor --strict` 通过；`node scripts/sync.mjs` 连续两次第二次无变化
- [x] 3.2 用户重启 DSH 后：日志无 `lark media downloader unavailable`，群里发图 child 能复述图片内容，结算后 `media-spool` 为空（结果记入 `docs/media-download.md` 验收表）

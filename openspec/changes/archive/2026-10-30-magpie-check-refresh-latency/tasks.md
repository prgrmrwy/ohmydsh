## 1. 客户端：检查完成刷新测速

- [x] 1.1 Write failing test: `test_line_check_refreshes_latency`（已保存线路点「检查线路」并拿到结果后多一次 `GET latency` 且无 `POST settings`；未保存草稿点检查不新增 latency 请求，延迟位保持 `idle`）
- [x] 1.2 Implement: `MagpieSettings` 把 `readLatency` 以 `onRefreshLatency` 传给 `Connection`；`runCheck` 在快照落地后、`draft.id` 存在时调用
- [x] 1.3 Refactor; package suite stays green（`npx vitest run`）

## 2. 版本与收尾

- [x] 2.1 版本 0.4.1：`packages/dsh-magpie-connector/package.json`、`package-lock.json`、`dsh.yaml`（version + note，仍守 80/600 上限）、`CHANGELOG.md` 新增 0.4.1
- [x] 2.2 校验：`openspec validate magpie-check-refresh-latency --strict`、包内 `npx vitest run`、仓库 `npm test`、`npm run check:artifacts`、`dsh build` 幂等
- [x] 2.3 归档 `magpie-check-refresh-latency` 后推 main，触发镜像 tag v0.4.1 / npm / GitHub Release，并按 SOP 核对

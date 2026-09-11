## 1. 固化缺陷证据（先写失败测试）

- [x] 1.1 在 `tests/` 新增构建新鲜度测试文件，复用 `tests/sync-deploy-refresh.test.mjs` 既有的 fake CLI 与临时 `DSH_HOME` 夹具模式，确保不污染真实 `$DSH_HOME`
- [x] 1.2 写出核心回归用例：源码 hash 与账本一致、`lib/` 存在但内容并非由该源码构建时，sync 必须重新构建且部署当前源码的产物；确认该用例在未改 `sync.mjs` 前**失败**（复现 2026-09-08 实测的静默陈旧部署）— 已确认失败，`actual: 'export const value = "STALE"'`
- [x] 1.3 补充用例：代次记录缺失时重建且不报错（旧账本升级路径）

## 2. 实施构建新鲜度判定

- [x] 2.1 在账本读取处读入新字段 `localPackageBuiltFrom`，缺失按空对象处理；并按既有惯例对 enabled owner 做结转
- [x] 2.2 修改 `needsBuild`：增加"记录的产物 hash 与当前产物 hash 不符即重建"，缺失记录视为不符 — 按 Decision 1 修订版改为比对**产物内容**而非源码输入（前两版间接判据均被测试证伪）
- [x] 2.3 在构建成功后写入 `{ input, output }` 记录（与部署成功解耦），确保构建成功但部署失败时不会重复构建
- [x] 2.4 构建前先 `delete` 记录、失败即 `continue`，故失败路径不写入记录，下次运行仍会重建
- [x] 2.5 在状态持久化处写出新字段；并在 `dsh reset` 清理路径一并删除，避免重置后残留记录被当作证据

## 3. 验证

- [x] 3.1 确认第 1 组测试全部转为通过 — 4/4 通过
- [x] 3.2 `npm test` 100 pass / 0 fail（新增 4 项）；`sync-deploy-refresh.test.mjs` 4/4 未回归
- [x] 3.3 `npm run check:artifacts` 通过
- [x] 3.4 实机幂等：第二次运行输出 `no changes — deployment already matches manifest`，无任何 build/重装
- [x] 3.5 实机验证：污染 `dsh-pet/lib`（guard 2→1）不动 `src`，sync 打印 `build local package dsh-pet` 并重建，源与部署产物均恢复为 2；现场已恢复
- [x] 3.6 升级路径：首次运行 7 个 local package 各重建一次（7 changes applied），第二次即 no changes

## 4. 收尾

- [x] 4.1 已回填 design.md Open Questions（字段定为 `localPackageBuiltFrom` = `{ input, output }`；已核实 `sync.mjs:254` 含 `node:${process.version}`，无需额外记录工具链版本），并按最终实现修订 Decision 1、proposal 与 specs delta 的措辞
- [x] 4.2 `openspec validate --strict` 通过
- [x] 4.3 归档 change；主规范 `openspec/specs/sync-local-deploy-refresh/spec.md` 已同步 2 条新 Requirement（6 scenarios）并更新 Purpose，原有 3 条 Requirement 完整保留，`validate --specs --strict` 21/21 通过

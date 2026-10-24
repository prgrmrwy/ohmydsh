# implementation-log

## 0.1 迁移前基线（2026-10-25，main @ ffc2f3a7a）

| 包 | typecheck | test |
|---|---|---|
| collab-kernel | exit 0 | 44 files / 272 passed / 0 skipped |
| dsh-collab | exit 0（需先 `npm run build` collab-kernel；首次运行时 lib 为 10-21 的旧产物，报 30 处类型错误，重建后消失） | 9 files / 152 passed / 0 skipped（vitest）+ node:test skipped 0 |
| dsh-pet | exit 0 | 202 files passed / 3 skipped，3430 passed / 8 skipped |

基线前修复一处既有缺陷：`packages/dsh-pet/test/fixtures/locus-snapshot.ts:36` 一行 `toolTier` 声明被重复粘贴在同一行（c907ede80 引入），导致 `locus-surface`、`locus-view` 两个测试文件解析失败。删除该重复行，两文件 69 个测试通过。不属于本 change 的行为改动。

8 个 skip 均为既有真实 runtime 探针（`inquiry-runtime-probe` 4、`independent-runtime-probe` 3、`locus-turn-observer-runtime` 1），之后每组对比不得增加。

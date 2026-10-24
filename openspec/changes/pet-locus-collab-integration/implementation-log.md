# implementation-log

## 0.1 迁移前基线（2026-10-25，main @ ffc2f3a7a）

| 包 | typecheck | test |
|---|---|---|
| collab-kernel | exit 0 | 44 files / 272 passed / 0 skipped |
| dsh-collab | exit 0（需先 `npm run build` collab-kernel；首次运行时 lib 为 10-21 的旧产物，报 30 处类型错误，重建后消失） | 9 files / 152 passed / 0 skipped（vitest）+ node:test skipped 0 |
| dsh-pet | exit 0 | 202 files passed / 3 skipped，3430 passed / 8 skipped |

基线前修复一处既有缺陷：`packages/dsh-pet/test/fixtures/locus-snapshot.ts:36` 一行 `toolTier` 声明被重复粘贴在同一行（c907ede80 引入），导致 `locus-surface`、`locus-view` 两个测试文件解析失败。删除该重复行，两文件 69 个测试通过。不属于本 change 的行为改动。

8 个 skip 均为既有真实 runtime 探针（`inquiry-runtime-probe` 4、`independent-runtime-probe` 3、`locus-turn-observer-runtime` 1），之后每组对比不得增加。

## 第 1–3 组（kernel、dsh-collab 句柄）

- task-1/2（kernel）：commit-time-01..03、dispose-01..05 均先红于"字段/方法不存在"，再实现。`auth.test.ts` 两个覆盖清单守卫随授权表新增一行而按设计变红，补一行用例，断言不变。提交 3f6c8ae85。
- task-3（dsh-collab 句柄）：接缝门 3.1 以真实 sessionController 会话、模型空闲时作 exec 验证成立（`establish-00`，controller-seams）。establish-01..04、handle-06 先红于"方法不存在"。额外 handle-07。提交 da2a05e2b。

## 第 4 组（dsh-collab 戳、投影、授权、cmdId）——TDD 顺序偏差与补证

**偏差**：stamp-01..19 一次写完、同时看到红、一次实现，没有按 4.1/4.3/4.5 分三轮。19 条的先红原因相同：替身 adapter 返回对象戳，旧代码只认字符串，调用者解析为 `COLLAB_CALLER_UNAVAILABLE`。对授权组与投影组来说，这个红因不能证明测试能抓住各自要防的缺陷。

**事后补证（变异核验）**：每次只改 `src/stamp.ts` 一处，跑 `stamp-projection.test.ts`，结束后还原并 `cmp` 逐字节一致。

| 变异 | 变红 | 失败原因 |
|---|---|---|
| 关掉写目标授权（`refusal()` 恒放行、去掉收件人检查） | 08、10、11、14、15、16、h1 | 修订/确认主会话条目被接受；引用他人消息成功；命令进内核并泄露 `currentRevision`；`to:'pet'` 时内核收到命令；子会话推进登记待办得到内核 `FORBIDDEN` 而非插件 `ITEM_NOT_FOUND` |
| 关掉投影（读取返回内核原始结果） | 03、04、05、06、07、10、13、h1 | 读到兄弟条目；兄弟消息与投递事件可见；状态文本能传话；`itemSeq` 泄露隐藏 ID；`pending.acks` 列出主会话条目；members 带出 `wakeCount`/`joinSeq` |
| 关掉 cmdId 命名空间 | 01、02、h1 | 两戳共用收据得 `COLLAB_CMD_CONFLICT`；收据 cmdId 无前缀 |

未变红：09、12 是正例（确认不误拦）；17、18、19 测戳解析与守卫，不在上述变异范围，它们最初的红因（戳不被识别）正属其范围。还原后 dsh-collab 178/178、typecheck 通过。

## Apply 期间规范修订

- AMD-1（2026-10-25）：`visible` 增加同步 `lookup.recordAt`，原因与评审复核见 review.md 末节；新增 `stamp-20`。
- task-7（AMD-1）：`stamp-20` 先红于"`visible` 只收到 2 个参数、lookup 未传"（插桩确认后撤掉），再实现；另对写授权单独变异（不传 lookup）确认 `stamp-20` 变红。dsh-collab 179/179。
- AMD-2（2026-10-25）：戳 `locusId` 改为由规范化入口键派生（第 1 版追 `replacesLocusId` 根被评审驳回：重建链不补、前驱不保证可达）；第 2 版评审复核接受。

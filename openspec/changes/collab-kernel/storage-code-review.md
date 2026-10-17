# collab-kernel 存储实现独立评审

## 结论

发现 **1 项实质问题（P2）**：完整日志行的非法 UTF-8 可在宽松解码后通过校验，随后尾片恢复还会按错误的字节偏移修改该损坏文件。修复并补充字节级回归之前，存储实现不通过。本结论是实现评审，不继承第 8 轮规划 APPROVE，也不是整个 change 的验收结论。

本次只写本报告，未改源码、测试、任务状态或其他文档；未安装、构建、提交或调用记忆工具。服务调度由另一位实现者并行修改，本次仅核对持久化接口和集成契约，不评审其在途 dispatch 实现。

## S1 · P2：宽松 UTF-8 解码掩盖完整行损坏，并使恢复截断偏移错误

**位置：** [file-store.ts:78–84](<../../../packages/collab-kernel/src/store/file-store.ts#L78-L84>)；同一宽松读取也用于 [提交前检查:138–141](<../../../packages/collab-kernel/src/store/file-store.ts#L138-L141>)。共同解析入口在 [completeRecords:19–30](<../../../packages/collab-kernel/src/store/file-store.ts#L19-L30>)。

**规范依据：** [存储规范:446–448](<specs/collab-kernel/spec.md#L446-L448>) 要求 UTF-8 JSONL；完整行解析或校验失败必须拒绝加载且不改文件，只有无换行尾片可截断。

**触发条件及复现：**

1. 用现有编码器生成 seq=1、`messageRef: '\uFFFD'` 的合法 completion 行。
2. 把该字符串在磁盘上的 `EF BF BD` 三字节替换为单字节 `FF`，保留 checksum 和末尾 LF。此时完整行含非法 UTF-8。
3. `readFile(path, 'utf8')` 把 `FF` 替成 U+FFFD；解析后内容与原始对象相同，现有 checksum 仍匹配，`open` 错误接受损坏行。提交前检查也会接受这种损坏。
4. 若再附加无 LF 的 `{"partial":`，`Buffer.byteLength(complete)` 计算的是替换后的字符串长度，比磁盘真正完整前缀长 2 字节；恢复保留了尾片开头 `{"`，并修改了本应保持原样的完整损坏日志。

**本次实际验证：** 只读取当前 TypeScript 源码并在内存转译；一次直接调用真实编码/解码函数，另一次调用真实 `FileStore.open/read`，注入所有会访问日志的内存文件操作，未写真实文件。输出分别为：

```json
{"diskBytesDiffer":true,"invalidUtf8":true,"decodedRecordAccepted":true,"byteLengthDelta":-2}
{"openAccepted":true,"recordCount":1,"actualCompleteBoundary":230,"truncateAt":232,"remainingPartial":"{\"","modifiedCompleteCorruptFile":true,"diskWrites":0}
```

这不是要求防御恶意宿主并发 rename；仅需磁盘上一个已经损坏的完整行，属于已有损坏恢复契约。

**最小修复：** 两个日志读取点读取原始 Buffer；按原始字节查找最后一个 `0x0A`，仅对完整前缀使用严格 UTF-8 解码（例如 fatal TextDecoder）并执行现有逐行解析/校验。任何完整前缀解码失败归为 `COLLAB_STORE_CORRUPT`，且不截断。`open` 验证全部完整行后，用原始 LF 后的字节偏移截断尾片。不要严格解码尚未提交的尾片：半个多字节字符也是可丢弃的正常尾片。

**必要回归：**

- 完整行的 U+FFFD 字节替成非法字节，`open` 拒绝且原字节不变。
- 同上再追加尾片，仍拒绝且不修改任何字节。
- 正常完整前缀后接半个 UTF-8 字符，正常恢复且精确截到原始 LF 边界，并 fsync。
- 已打开空间的日志发生同类损坏，`commit` 拒绝、不追加并进入 failed。

## 其余已核对项目

- [canonical.ts](<../../../packages/collab-kernel/src/store/canonical.ts>) 按默认键排序重建普通对象、保持数组顺序；拒绝非有限数、非 JSON 对象、循环和无效数组元素；用 null-prototype 对象保留自有 `__proto__`；删除对象 undefined 字段。checksum 去掉媒体字段 `sha256`，decode 不把该字段带回服务层。固定向量和独立摘要断言见 [file-store.test.ts](<../../../packages/collab-kernel/test/file-store.test.ts>) 与 [store.test.ts:125–142](<../../../packages/collab-kernel/test/store.test.ts#L125-L142>)。
- [FileStore 提交队列:124–165](<../../../packages/collab-kernel/src/store/file-store.ts#L124-L165>) 在接纳时编码快照、排队后重新读取当前日志路径并检查连续 seq/expectedLastSeq；短写循环必须前进；文件 fsync 后，首次创建执行目录 fsync，再更新缓存。I/O/校验/冲突失败封闭后续提交。没有要求增加每次提交的目录 fsync、快照或 SQLite。
- [生命周期:62–112](<../../../packages/collab-kernel/src/store/file-store.ts#L62-L112>) 跟踪 opening/closing，close 立即停止接纳、等待已在执行的存储操作并阻止尚未执行的排队提交；所有权清理核对 inode 和实例 id。现有测试覆盖 open/close 重叠、并发 close、短写、fsync 失败、替代锁保护和完整坏行先于尾片的情况，但没有 S1 的字节级用例。
- [锁策略:113–123](<../../../packages/collab-kernel/src/store/file-store.ts#L113-L123>) 不判断 PID 生死、不自动接管；宿主证明旧持有者不存在仍是 `breakLock` 的前置条件。这里不要求存储实现证明死亡，也不把等权宿主主动违反前置条件当作实现缺陷。
- [接口](<../../../packages/collab-kernel/src/store/interface.ts>) 的 `read(fromSeq)` 是 inclusive；服务 `readSince` 是 exclusive，符合已约定的分层语义。[CommitRecord](<../../../packages/collab-kernel/src/model/index.ts#L41>) 区分 command/completion；[MemStore 测试替身](<../../../packages/collab-kernel/test/support/mem-store.ts>) 不需要媒体 checksum。
- [包声明](<../../../packages/collab-kernel/package.json>) 无运行时依赖，存储使用 Node 内建模块。当前每次提交重读日志在已接受的数百/数千记录规模内不作为性能阻塞项。

## 服务集成边界（不替代调度评审）

[持久化入口:70–81](<../../../packages/collab-kernel/src/service/index.ts#L70-L81>) 必须保持“store.commit 成功 → reduce/内存应用 → 成功响应”；内存应用失败同样 failed。公开命令和 completion 必须共用空间队列与 seq；close 必须等待存储操作，但不无限等待 SPI；旧 generation 的迟到回调不能跨 close/reopen 追加，也不能恢复后自动重新投递。需由 dispatch owner 的最终实现及磁盘集成回归确认这些条件；本报告不批准并行变更中的服务实现。

## 验证范围与历史真实性

- 实际完成：阅读规划规范、设计 D4/D5、规划评审、任务/测试映射、完整存储实现、模型、服务 open/close/persist 接口、FileStore 单测、磁盘服务集成测试及故障替身；执行上述两个纯内存探针。
- **未执行** Vitest、typecheck、build、根回归、OpenSpec strict、真实进程崩溃或断电测试。遵守只读范围，没有运行会创建/删除临时目录的磁盘测试。
- 主代理报告 FileStore **40/40**、存储服务集成 **13/13**；这是主代理的执行证据，不是本评审者重跑，也不覆盖新发现的 S1。
- [实施记录:18–22](<implementation-log.md#L18-L22>) 已明确首批 7 个测试是实现后补写；后续 36 个用例中 24 个真实 RED，最终 40 GREEN。后续补测不能追溯改变首批未遵守 test-first 的事实。本评审不把绿色结果或任务勾选当成原始 TDD 合规证明。

REVIEW: FAIL

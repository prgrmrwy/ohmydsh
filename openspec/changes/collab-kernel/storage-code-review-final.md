# collab-kernel 存储终态独立复核

## 结论

**REVIEW: PASS（仅存储范围）。** 原 S1 的两个根因——完整行宽松 UTF-8 解码，以及用解码后字符串反算截断偏移——均已消失；没有发现本次范围内需要阻断的严重问题。本结论来自当前源码、测试断言审查及本评审者实际重跑，不采信修复者的绿色报告作为执行证据。

What this change does: 存储读取改为原始字节定界，只严格解码完整提交前缀，全部校验成功后才截断未提交尾片。锁错误增加类型化详情，同时保留原顶层路径和原始内容。

原 [FAIL 报告](<storage-code-review.md>) 保留原样，S1 的历史复现及当时 FAIL 仍然有效；本报告是修复后的独立复核，不追溯覆盖历史证据，不批准 service 并行修改中的生命周期/调度实现，也不是整个 change 的验收。

## 1. 范围与依据

- 阅读 [manifest](<../../../dsh.yaml>)、[proposal](<proposal.md>)、[design D4/D5](<design.md#L88-L106>)、[存储规范](<specs/collab-kernel/spec.md#L442-L513>)、[tasks 存储段](<tasks.md#L79-L83>) 和 [包说明](<../../../packages/collab-kernel/README.md>)。本 capability 尚无已同步的 current spec；本次按 change 的已批准存储规范复核。
- 完整阅读 [FileStore](<../../../packages/collab-kernel/src/store/file-store.ts>)、[canonical](<../../../packages/collab-kernel/src/store/canonical.ts>)、[接口](<../../../packages/collab-kernel/src/store/interface.ts>)、[模型](<../../../packages/collab-kernel/src/model/index.ts>)、[FileStore 单测](<../../../packages/collab-kernel/test/file-store.test.ts>)、[存储集成测试](<../../../packages/collab-kernel/test/store.test.ts>)、[故障替身](<../../../packages/collab-kernel/test/support/faulty-fs.ts>)，并检索编码/解码和锁详情的调用点。
- 负载假设沿用 [design:159](<design.md#L159>)：单写入方、每空间数百至数千条提交；不扩展为分布式锁、恶意同权宿主并发替换文件的安全保证。
- 本评审唯一主动写入的交付文件为本报告。获准运行的既有测试会自行创建及清理临时夹具；未新增测试文件、改源码、改原 FAIL、安装、部署、构建、提交或调用记忆工具。

## 2. S1 根因核验：已关闭

### 2.1 两个磁盘读取点均使用原始 Buffer

[open/load:86–93](<../../../packages/collab-kernel/src/store/file-store.ts#L86-L93>) 和 [commit:146–150](<../../../packages/collab-kernel/src/store/file-store.ts#L146-L150>) 均不再传入 `'utf8'` 编码；两者都调用唯一的 [completeRecords:19–32](<../../../packages/collab-kernel/src/store/file-store.ts#L19-L32>)。

入口以 `content.lastIndexOf(0x0a) + 1` 计算原始 LF 后偏移。没有再以 `Buffer.byteLength(decodedString)` 决定截断位置，非法字节变成 U+FFFD 后增加长度的问题不再存在。

### 2.2 完整前缀严格校验，尾片不解码

[解析入口:24–31](<../../../packages/collab-kernel/src/store/file-store.ts#L24-L31>) 对 `content.subarray(0, completeBytes)` 使用 `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`。非法 UTF-8 在 JSON/checksum 前失败，并统一为 `COLLAB_STORE_CORRUPT`。全部完整行必须通过 JSON、checksum 和连续安全整数 seq 校验，之后才返回边界。

`ignoreBOM: true` 的语义是忽略 BOM 的特殊处理，**不是删除 BOM 字符**：UTF-8 BOM 被保留为 U+FEFF，因此行首 BOM 不能被静默移除后通过 JSON.parse。已用当前 Node 的内存 assert 探针独立确认此语义，以及非法 `FF` 拒绝、半个 UTF-8 尾片不进入 decoder。探针不创建文件。

[load:89–94](<../../../packages/collab-kernel/src/store/file-store.ts#L89-L94>) 先得到全部校验结果，之后才 `truncate(completeBytes)` 和 `sync()`；完整坏行之前/之后有尾片都不会先截尾。没有 LF 的整个文件属于未提交尾片，按规范可截为零。

[commit:149–154](<../../../packages/collab-kernel/src/store/file-store.ts#L149-L154>) 使用相同严格解析入口，且任何尾片直接拒绝，不做提交期恢复；失败后 [170–174](<../../../packages/collab-kernel/src/store/file-store.ts#L170-L174>) 设置 failed。`bytes.toString('utf8')` 仅用于本次由 JSON 编码器产生的有效新记录，不是磁盘旧内容的宽松解码漏洞回流。

## 3. 四类独立 oracle：均真实执行通过

这里的“四类”对应原 S1 要求，不把参数化测试数量误称四个测试。新增 S1 回归实际展开为 6 个用例（2 + 3 + 1）。fixture 可以使用产品编码器构造合法初始行，但判定损坏/恢复结果不再依赖产品 decoder 的自证。

| 原 S1 场景 | 当前断言位置 | 独立判据与实际结果 |
|---|---|---|
| 完整行 U+FFFD 三字节替换为单字节 FF，无尾片 | [单测:99–113](<../../../packages/collab-kernel/test/file-store.test.ts#L99-L113>)，空 tail 分支 | 明确查找 `EF BF BD` 并断言存在，替换成 `FF`；直接比较磁盘 Buffer 与注入坏字节、断言 `COLLAB_STORE_CORRUPT`。PASS。旧宽松解码会恢复原 U+FFFD 并错误接受，此断言确实能击中 S1。 |
| 同一完整坏行之后追加无 LF 尾片 | [单测:99–113](<../../../packages/collab-kernel/test/file-store.test.ts#L99-L113>)，`E4 B8 FF` tail 分支 | 再次比较整个磁盘 Buffer 不变、断言 CORRUPT；不是只检查 read 返回值或解析成功。PASS。 |
| 合法非 ASCII 完整前缀 + 半 UTF-8 尾片 | [单测:114–125](<../../../packages/collab-kernel/test/file-store.test.ts#L114-L125>) | 前缀含中文、é、emoji、真实 U+FFFD；尾部覆盖 `E4 B8`、`FF`、`F0 9F 92`。恢复后原始磁盘字节必须恰等于保存的完整 Buffer；sync 轨迹必须恰为 `['file']`，另断言记录。3 分支全部 PASS。 |
| 已打开日志发生同类损坏后 commit | [单测:126–141](<../../../packages/collab-kernel/test/file-store.test.ts#L126-L141>) | 先真实提交，再从磁盘读取并替换字节；第二次提交必须 CORRUPT，磁盘不得追加/改动；随后 commit 和 read 都必须 FAILED。PASS。 |

fsync oracle 不是空 mock：[faulty-fs:18–29](<../../../packages/collab-kernel/test/support/faulty-fs.ts#L18-L29>) 排除锁的 wx 句柄，针对日志句柄记录 `'file'`，正常分支随后调用真实 `handle.sync()`。字节相等断言也直接使用 Node `readFile` 返回的 Buffer，未借产品 checksum/decode 计算期望。

另有 [完整空行/坏 checksum 后接尾片:92–98](<../../../packages/collab-kernel/test/file-store.test.ts#L92-L98>) 验证“所有完整行通过后才能恢复”的顺序，避免只修 UTF-8 而遗漏更早的完整行损坏。

## 4. typed lock details 与 raw 顶层兼容

**未发现新增异常丢锁或锁诊断回归。**

- [模型:46–48](<../../../packages/collab-kernel/src/model/index.ts#L46-L48>) 明确允许 `details.lockPath` 与 `details.lock: { instanceId: string; pid: number }`。
- [lockDetails:49–60](<../../../packages/collab-kernel/src/store/file-store.ts#L49-L60>) 总会构造 `COLLAB_STORE_LOCKED`；读取失败保留空 raw，JSON 无法解析或为 null 不会替换为 TypeError。只把 string instanceId 和安全整数 pid 放入结构化详情，其他属性不透传；`Object.assign` 继续保留顶层 `lockPath` 和原始 `lock` 字符串。
- [单测:255–282](<../../../packages/collab-kernel/test/file-store.test.ts#L255-L282>) 已实际覆盖合法详情、额外字段过滤、非法 JSON、错误字段类型、null，以及 open 和 mismatch breakLock 的 raw 顶层兼容。没有把格式错误当作可抢占信号。
- `lockDetails` 本身没有 unlink；[open:81–82](<../../../packages/collab-kernel/src/store/file-store.ts#L81-L82>) 在 EEXIST 时直接走它；[breakLock:122–131](<../../../packages/collab-kernel/src/store/file-store.ts#L122-L131>) 只在实例 id 精确匹配时删除。调用前证明持有者不存在仍由宿主负责，不因 PID 看似过期而自动接管。
- [removeOwnedLock:61–69](<../../../packages/collab-kernel/src/store/file-store.ts#L61-L69>) 同时核对 dev/ino 和实例 id；[失败加载替代锁保护:195–208](<../../../packages/collab-kernel/test/file-store.test.ts#L195-L208>)、[集成锁隔离/替代/残留/精确解除:275–320](<../../../packages/collab-kernel/test/store.test.ts#L275-L320>) 均重跑通过。格式损坏的锁在 close 时可能报错并保留，而非猜测所有者后删除，符合 fail-closed 边界。

## 5. 完整存储终态核对

- **规范化/摘要：** [canonical:3–40](<../../../packages/collab-kernel/src/store/canonical.ts#L3-L40>) 按规范的对象键排序重建及标准 JSON.stringify，保留数组顺序；删除对象 undefined、拒绝非 JSON 值和循环；null-prototype 输出保留自有 `__proto__`。checksum 排除顶层媒体字段 sha256，decode 不向上返回该字段。固定向量与硬编码 JSON 独立摘要由 [单测:18–48](<../../../packages/collab-kernel/test/file-store.test.ts#L18-L48>)、[集成:125–142](<../../../packages/collab-kernel/test/store.test.ts#L125-L142>) 验证，不只做 encode/decode round-trip。
- **提交顺序：** [commit:133–174](<../../../packages/collab-kernel/src/store/file-store.ts#L133-L174>) 接纳时编码快照、同空间排队、执行时重新读当前文件检查完整日志和 expectedLastSeq；写满循环拒绝零/无效进度，文件 fsync 后首次创建再目录 fsync，完成后更新缓存。失败封闭后续操作。既有短写、写失败、目录 fsync、冲突测试均通过。
- **存储生命周期：** [open/close:71–121](<../../../packages/collab-kernel/src/store/file-store.ts#L71-L121>) 追踪 opening/closing；close 立即停止接纳，等待存储队列，尚未执行的队列项拒绝。单测覆盖 open/close 重叠、并发 close、进行中写入成功/失败两分支；未以这些结果替代 service generation 的独立验收。
- **读取与恢复：** [read/list:176–184](<../../../packages/collab-kernel/src/store/file-store.ts#L176-L184>) 返回记录快照；[接口:7–8](<../../../packages/collab-kernel/src/store/interface.ts#L7-L8>) 的 fromSeq 为 inclusive，service readSince 的 exclusive 语义由 [集成:322–337](<../../../packages/collab-kernel/test/store.test.ts#L322-L337>) 验证。重启状态、完整行保留、部分多事件提交丢弃、fsync 未知结果由同 cmdId 重放判定，存储集成共 13 项通过。
- **复杂度：** 每次 commit 全量重读日志在已接受的空间规模内不列为阻断项；不要求无需求的快照、SQLite、额外目录 fsync 或锁接管策略。

## 6. 本评审者实际执行

所有 Bash 的显式 workdir 均为绑定 worktree 根；使用当前源码而非旧 lib。执行时间为 2026-10-17 02:30–02:31（Asia/Shanghai）。

```bash
npm --workspace packages/collab-kernel test -- --run test/file-store.test.ts test/store.test.ts --cache=false --reporter=verbose
npm --workspace packages/collab-kernel run typecheck
```

- 第一条：**2 files passed，60/60 tests passed（FileStore 47 + store integration 13），Type Errors: no errors，exit 0**。verbose 输出包含上表全部字节级回归及 typed/raw lock 测试。
- 第二条：生产与测试两个 `tsc --noEmit` 均完成，**exit 0**。
- 额外无文件探针：Node assert 验证 BOM 保留且 JSON.parse 拒绝、`FF` fatal 拒绝、仅截取 LF 前缀时半 UTF-8 尾片未被解码。输出：`{"bomPreservedAsJsonInvalid":true,"invalidUtf8Rejected":true,"incompleteTailNotDecoded":true}`。

### 审查快照指纹（SHA-256）

用于后续区分并行修改后的新快照；不是提交哈希。

| 文件 | SHA-256 |
|---|---|
| [file-store.ts](<../../../packages/collab-kernel/src/store/file-store.ts>) | `0f7fd1da1399eca44cb91bcc6c50f1e87cf248d39d9f58e2b18b38fc20a4270e` |
| [canonical.ts](<../../../packages/collab-kernel/src/store/canonical.ts>) | `c1eeb31da881904bf314fb9b4d2c71ee9e45b23595ccb699764751b59e4139c6` |
| [interface.ts](<../../../packages/collab-kernel/src/store/interface.ts>) | `deecba16321a3139e23e0a61e5da7d77b3961fa5eb47bf8e7c72fce47a2975c2` |
| [model/index.ts](<../../../packages/collab-kernel/src/model/index.ts>) | `2323c594bbb5a578d6c539b6e090b4e9caf024acf86bb906af7d0518ea76e084` |
| [file-store.test.ts](<../../../packages/collab-kernel/test/file-store.test.ts>) | `03bc3eec4556208a6efe08c30dbae536386a9e8429531296c7065ef39e99e1f5` |
| [store.test.ts](<../../../packages/collab-kernel/test/store.test.ts>) | `6b4bc43d7ec97d2944a8134745004b481bf2b724c06276768ae41b9fc6d5260d` |
| [原 FAIL](<storage-code-review.md>) | `c0aef4c68b6803f1ba06755a8ee567817d0e5a1a435f90078b6ac627ef1d9ffe` |

## 7. 未完成/未纳入本次验证

1. **未审查 service 在途生命周期修复，也未运行 dispatch/lifecycle 专项套件。** 存储集成 13 绿不等于最终 service close/reopen、迟到 SPI generation 隔离通过；应由对应 owner 的最终快照独立验证。
2. 未运行包全量测试、build、根仓库测试、check:artifacts、OpenSpec strict；这些不是本次存储 PASS 的隐含证据。
3. 未执行真实进程 kill、主机崩溃/断电、跨进程抢锁压力或真实文件系统故障；当前持久化证据是实际磁盘 I/O 加可控故障注入，不能证明硬件断电行为。
4. BOM 保留语义经过实际 Node 内存探针及源码调用链检查；**未新增或执行专门的 FileStore 磁盘 BOM 回归用例**。现有四类 S1 oracle 不包含 BOM 专项。
5. 不重建历史 RED/TDD 证据，不把本次绿色复核倒推为此前一直正确或原先 test-first 合规。

无严重 finding，故无待实施的最小修复。**Verdict: Ship（限定存储范围）。**

REVIEW: PASS

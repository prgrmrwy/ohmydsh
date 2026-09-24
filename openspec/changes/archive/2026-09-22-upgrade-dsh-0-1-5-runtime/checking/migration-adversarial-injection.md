# 任务 3.4 验收证据:迁移对抗性注入 → fail closed + 备份可恢复

## 结论(先行)

四类注入全部实测完毕。**失效模式分三类,不是一刀切的 fail closed —— 其中一类确实
"没有 fail closed",如实记录。**

| # | 注入 | 判定 | 退出码 | 是否产出新 generation |
|---|---|---|---|---|
| 1a | 尾部**截断** 41%(落在帧中间) | ⚠ **未 fail closed(设计内的"尽力恢复")** | **0** | **是**,且是**静默的半截会话** |
| 1b | 中间**翻转 64 字节** | ✅ **fail closed** | **1** | 否 |
| 1c | 迁移后破坏**当前 v3 代** | ✅ **fail closed(且不回退到完好的旧代)** | **1** | 否 |
| 2a | header `version=99`(文件名 v0) | ✅ **fail closed** | **1** | 否 |
| 2b | header `version="99"`(非法类型) | ✅ **fail closed** | **1** | 否 |
| 2c | header `version=2` | ✅ **fail closed** | **1** | 否 |
| 2d | header v99 + 文件名 v99(自洽) | ✅ **fail closed(文档化拒绝文本)** | **1** | 否 |
| 2e | 完好 v0 **加**一个不可读 v99 代 | ✅ **fail closed(拒绝而非回退 v0)** | **1** | 否 |
| 3a | **陈旧 lockfile**(无持有者) | ✅ 不阻塞(**设计如此**) | **0** | 是(正常迁移) |
| 3b | **两个活 writer** | ✅ **排他,第二个被拒** | **1** | 否(被拒方) |
| 3c | 持有期间**外部删除** lock 文件 | ❌ **排他性失效(双写窗口)** | **0** | 是 |

**最强的正面结论**:4 个场景(SIGKILL×2、备份恢复重建、干净基线)产出的
`session.v3.jsonl.zstd` **SHA-256 完全相同**(`166fe87a4e77a690…`)—— 迁移是**确定性**的,中断后重跑
得到的不是"差不多完整",而是**逐字节相同**。

**最强的负面结论**:1a 的截断**确实会静默产出半截会话并发布为新 generation**,没有任何警告。
详见 §4.1 与 §9。

---

## 1. 测试场与素材

| 项 | 值 |
|---|---|
| 宿主机 | devbox `n37-044-026`,Linux x86_64 |
| Node | `v22.23.2`(`~/.nvm/…/v22.23.2/bin/node`,显式 export PATH) |
| 可破坏素材 | `/tmp/official-home-3x/{mig,golden,work}`(`umask 077`),均由备份**解出的副本** |
| 备份来源 | `/data00/home/zhangyong.617/dsh-backup-20260921-161053/dsh-home.tgz`(升级前) |
| 读取路径 | **官方** `@deepseek-ai/dsh-session-persistence-jsonl@0.1.5-rc.2`,经 cordis `ctx.plugin()` 装载,`config.root` 指向副本 |
| 生产环境 | `$DSH_HOME=/home/zhangyong.617/.dsh` **全程只读**;端口 3099;**未触碰 3080/3081** |

### 1.1 格式权威(读源码,不靠猜)

| 事实 | 出处(目标树 `fb2c4b9`) |
|---|---|
| `SESSION_FORMAT_VERSION = 3` | `packages/core/session/src/types.ts:88` |
| header 必填键 `type/version/id/createdAt/isSeeded/delegationDepth` | `session-persistence-jsonl/src/format.ts` `HEADER_REQUIRED_KEYS` |
| **外来版本先于结构校验被拒** | `refuseForeignFormatVersion()`:"its user must see 'upgrade the harness', never 'corrupt session log'" |
| 拒绝文本(方向敏感) | `session-persistence/src/errors.ts:133` |
| 租约 = POSIX `flock(2)`,内核仲裁,**无过期** | `session-persistence-jsonl/src/lease.ts` 模块注释 |
| 删锁文件即放弃排他(POSIX) | 同上:"Removing a live session's lock file therefore forfeits exclusion on POSIX (nothing in the harness does so)" |

### 1.2 ⚠ 多帧 zstd 陷阱(已实测复现,不是转述)

Session 日志是**多帧拼接** zstd。朴素一次性解码**在第一个帧就停**:

```
样本 dd03534e…/session.jsonl.zstd (280,990 bytes)
  朴素 zstdDecompress 一行性解码 -> 1 行
  多帧解码                     -> 95 帧 / 310 行
```

**因此本文档所有"行数/事件数"均用多帧解码器产出**:先按目标源码 `zstd.ts::scanZstdFrames`
的结构化算法切出完整帧边界,再对**每一帧**调用公开 `zlib.zstdDecompressSync` 拼接。
未用该方法的任何"1 行"结论都是无效的。

## 2. 基线(注入前)

对备份副本全量扫描,并与官方读取路径交叉核对:

| 指标 | 实测值 |
|---|---|
| 会话文件数 | **40** |
| 项目目录数 | 6(`opensource-ohmydsh` 26、`corp-nexus` 6、`dsh-pet/workspace` 3、`learning` 2、`nexus_workspace` 2、`dev-infra-server` 1) |
| **磁盘 header 版本** | **全部 v0**(`{"0": 40}`) |
| 解码总行数 | **79,450** |
| 结构性错误 | **0** |
| 磁盘文件名模式 | 只有 `session.jsonl.zstd`(尚无任何 `vN` 代) |

**读数陷阱(必须记住)**:官方 `list()` 对**全部 40 个文件**都报 `header.version = 3`。
这不是"已迁移"——`format.ts::fromHeaderLine()` 会把 `version` **覆写**为 `SESSION_FORMAT_VERSION`。
磁盘真值(v0)是独立用多帧解码器读出来的。**不要把 list() 的 v3 当成迁移证据。**

本轮定点使用两个会话,官方读取路径基线:

| 会话 | 干净读取事件数 | 备注 |
|---|---|---|
| `session-9b1d53c7-…`(5,564 行 / 4172 帧) | **654** | 中小样本,用于注入 1/2/3 |
| `session-c9136c7b-…`(18,671 行 / 18251 帧,3,396,604 B) | **75** | 最大样本,用于注入 4 |

事件数远小于行数(5,564→654)是 v1→v2 折叠流式 chunk 的正常结果,**不是内容丢失**
(与 `session-migration-acceptance.md` 的结论一致)。

### 2.1 迁移触发与发布机制(实测)

| 操作 | 实测结果 |
|---|---|
| `open(id, "read")` | **不迁移**。`ls` 前后完全一致,无 `session.lock`、无 v3 |
| `open(id, "write")` | **迁移**:写出 `session.v3.jsonl.zstd` + `session.lock`,并**保留** `session.jsonl.zstd` |

发布是**临时文件 + 改名**,高频(20ms)观测到的完整时序:

```
54.593  session.lock:0
54.977  session.migration.32afc32b0f40a999.jsonl.zstd.tmp:0
55.001  session.migration.32afc32b0f40a999.jsonl.zstd.tmp:186
55.050  session.migration.32afc32b0f40a999.jsonl.zstd.tmp:268290
(之后 .tmp 消失,出现 session.v3.jsonl.zstd:268290)

3.4 MB 会话端到端耗时 ≈1.06s(含约 0.25s 启动),临时文件窗口 ≈100ms
```

该窗口的存在正是注入 4 能精确命中的前提。

---

## 3. 注入 1:损坏

### 3.1 (1a)尾部截断 —— **未 fail closed** ⚠

| 项 | 值 |
|---|---|
| 注入 | `truncate -s 1012096`,原 1,686,827 B,**砍掉 41%** |
| 期望 | 不得静默产出半截/空会话 |
| **实测** | **exit 0**,读回 **409 事件**(干净基线 **654**)—— 仍是 **62.5%** |
| 产出 | `session.v3.jsonl.zstd` **382,913 B 被发布**;`session.jsonl.zstd`(已截断)保留 |
| 报错/警告 | **无。stderr 为空。** |

**判定:这一格没有 fail closed。** 系统按"撕裂尾部修复"语义**静默地**把可用的连续前缀迁移成了一个
**更短的新 generation**,调用方无法从退出码或输出得知会话被截短。

需要公平记录的两点缓解事实:(a) 保留的是**连续前缀**,不是中间空洞;(b) 旧 generation 文件仍在原位
(但它就是被截断的那个,原始字节已由我破坏,不可回滚 —— 真正可回滚的是**备份**,见 §8)。

### 3.2 (1b)中间翻字节 —— **fail closed** ✅

| 项 | 值 |
|---|---|
| 注入 | 在 offset 843,413 起把 **64 字节 XOR 0xFF** |
| **实测(write)** | **exit 1**,无新 generation |
| **实测(read)** | **exit 1**(只读路径同样拒绝) |
| 错误类 | `SessionPersistenceCorruptionError` |
| 错误文本 | `session "session-9b1d53c7-…": stored log is corrupt: Error: corrupt Zstandard session log: invalid frame magic at byte 843470 (raw log: …/session.jsonl.zstd)` |
| 残留 | 仅 `session.lock`(0 字节,已释放) |

### 3.3 (1c)迁移后破坏**当前** v3 代 —— fail closed,**不回退** ✅

这是任务里"安全回退到旧 generation"的直接检验。步骤:先干净迁移(v0+v3 并存),再翻坏 **v3**。

| 项 | 值 |
|---|---|
| 干净迁移后 | v0 sha `0db8619a653aed14`,v3 sha `1a0b57d1fe7070b1`;654 事件 |
| 注入 | 在 v3 的 offset 306,897 翻 64 字节 → v3 sha `3136a5d91a0670aa` |
| **实测(read)** | **exit 1**,`SessionPersistenceCorruptionError`:`corrupt Zstandard session log: frame at byte 189 failed validation` |
| **实测(write)** | **exit 1**,同一错误 |
| **旧 v0 是否被回退使用** | **否。** v0 sha 仍为 `0db8619a653aed14`,**逐字节未动**,但**没有被自动选用** |
| 残留 | v0 与 v3 都留在盘上,无新 generation |

**判定:系统一律选择"明确报错拒绝",从不自动回退到旧 generation。** 这与上游
`AGENTS.md` 的 "predecessors imply neither fallback nor downgrade support" 一致 ——
所以"安全回退到旧 generation"这条备选路径在本运行体上**不存在**,但拒绝路径是可靠的。

### 3.4 判定小结(注入 1)

**三种子情形、两种语义**:截断走"尽力恢复"(**静默**),结构性损坏走"拒绝"。
**任务期望的"不得静默产出半截会话"在截断这一格未被满足。**

---

## 4. 注入 2:不支持的格式 —— 全部 fail closed ✅

注入方式:解出第 0 帧(header 帧),改 JSON 后按写入端同样参数
(`ZSTD_c_checksumFlag=1`)重压,再与其余 4,171 帧原样拼回 —— **只动 header,事件帧逐字节保持**。

| # | 注入 | exit | 错误类 | 错误文本(实测) |
|---|---|---|---|---|
| 2a | `version=99`,文件名仍 `session.jsonl.zstd` | **1** | `SessionPersistenceCorruptionError` | `resolved JSONL source filename identifies v0, but its header identifies v99` |
| 2b | `version="99"`(字符串,非法类型) | **1** | `SessionPersistenceCorruptionError` | `corrupt session log: header version is not a non-negative safe integer` |
| 2c | `version=2` | **1** | `SessionPersistenceCorruptionError` | `resolved JSONL source filename identifies v0, but its header identifies v2` |
| 2d | `version=99` **且**改名 `session.v99.jsonl.zstd`(自洽) | **1** | `SessionFormatUnsupportedError` | `session "session-9b1d53c7-…" uses log format v99, but this harness reads only v3: the log was written by a newer harness — upgrade the harness to open it` |
| 2e | 完好 v0 **加**一份 v99 代(两代并存) | **1** | `SessionFormatUnsupportedError` | 同 2d,指向 `session.v99.jsonl.zstd` |

关键观察:

- **2a/2c 命中"文件名 ↔ header 版本互证"这道更早的闸门**,所以没走到文档化的"upgrade the harness"文案。
  这说明 header 里的版本号**不是**自由字段:它必须与文件名指认的代一致。
- **2d 才命中任务想要的 fail-closed 文案**,且 read 与 write 都拒。
- **2e 是最有价值的一格**:磁盘上同时存在一份**完好可读的 v0** 与一份**不可读的 v99**,
  读取器**拒绝**,**不降级回退**到 v0。即"新版本存在"就足以让整个会话不可读 —— 这是刻意的保守设计,
  但也意味着**一次误写入的高版本 generation 会让可读的旧数据一并不可达**(运维含义,非缺陷)。
- 五格全部 exit 1,全部**未产出新 generation**。

---

## 5. 注入 3:写所有权竞争

| # | 场景 | exit | 实测 |
|---|---|---|---|
| 3a | **陈旧 lockfile**:手工 `: > session.lock`(0 字节,无任何进程持有 flock) | **0** | `OPENED_OK`/654 事件,正常迁移成功 |
| 3b | **两个活 writer**:A `open(write)` 持有 12s,B 期间 `open(write)` | B=**1** | `SessionAlreadyOwnedError`: `session "session-9b1d53c7-…" is already owned by an active write handle`;A 不受影响,正常走到 CLOSED |
| 3c | A 持有时**外部 `rm session.lock`**,再让 B `open(write)` | B=**0** | **B 成功打开** —— 排他性被放弃(双写窗口) |

**判定:**

- **3a 不是缺陷。** 租约的内核仲裁者是 `flock(2)`,进程死亡即释放;`session.lock` 文件本身只是
  "稳定 inode 的锚点"。所以**陈旧 lockfile 不阻塞后续 writer 是设计正确的**,
  且恰好回答了任务里"stale lockfile"这一问:它**不**构成排他条件。
- **3b 是真正的排他证据**:第二个 writer 被**明确拒绝**(专用错误类 + 明确文本),不是静默双写。
- **3c 复现了源码里自己写下的危险边界**:删除活锁文件后,持锁者锁住的是**已被 unlink 的孤儿 inode**,
  新 writer 在新 inode 上拿到锁 → 两者同时认为自己独占。
  **前提是必须有一个外部行为体去删锁文件**;上游注释明确 "nothing in the harness does so"。
  因此这是**可复现的既有边界**,不是本仓库 overlay 引入的问题,但值得在运维层面知道。

---

## 6. 注入 4:中断(SIGKILL 于迁移中途)

**方法**:20ms 轮询会话目录,一发现 `session.migration.*.tmp` 就 `kill -9` 主进程。
两个杀点分别命中临时文件 **186 B**(刚建)与 **268,290 B**(已写满、改名前一瞬)。基线为 §2.1 的干净迁移。

### 6.1 杀后立刻的磁盘状态

| 项 | 4a(186 B) | 4b(268,290 B) |
|---|---|---|
| `session.jsonl.zstd`(v0) | **完好**,sha `a1e52f46fbc025f0` = 原始值 | **完好**,同左 |
| `session.v3.jsonl.zstd` | **不存在** | **不存在** |
| `session.lock` | 存在(0 B) | 存在(0 B) |
| 残留 | `session.migration.666918b46….jsonl.zstd.tmp`(186 B) | `session.migration.f9f5bfefb….jsonl.zstd.tmp`(268,290 B) |

**未留半迁移 generation**:`.tmp` 名字**不是**规范代名,不被代发现逻辑认作 generation,
所以"半截产物"没有变成可读状态。

### 6.2 重跑后的结果

| 项 | 4a | 4b |
|---|---|---|
| 重跑 `open(write)` | **exit 0** | **exit 0** |
| 读到事件数 | **75** = 干净基线 | **75** = 干净基线 |
| 发布出的 v3 | 268,290 B,sha **`166fe87a4e77a690`** | 268,290 B,sha **`166fe87a4e77a690`** |
| 与干净迁移对比 | **逐字节相同** | **逐字节相同** |
| v0 | sha `a1e52f46fbc025f0`,未动 | 同左 |
| 之后 `stat` 选中的代 | v3(`{"v":3,"sizeBytes":268290}`) | v3(同) |

**判定:不留半迁移状态;重启后能选出一个完整 generation;内容完整(以字节同一性证明,强于计数相等)。**

**顺带发现(小)**:崩溃残留的 `session.migration.<hex>.jsonl.zstd.tmp` **不会被回收** ——
重跑成功后仍留在目录里(两个案例各残留 1 个)。它无害(不参与代发现),但会**逐次累积**,
长期反复中断的会话目录会积垃圾文件。

---

## 7. 备份可恢复(每一步之后都验证)

原始备份**从未被写入**,所有破坏只发生在 `/tmp/official-home-3x/work/*` 的副本上。
即便如此,仍按"可恢复"给出三重实证:

### 7.1 副本零漂移(注入前后对比)

在**任何注入之前**对 golden 副本建立了 manifest(40 条:file、sha256、bytes、帧数、行数、header 版本)。
全部注入结束后重扫:

```
golden:               files=40/40  rows=79450  DRIFT=0  MISSING=0  => IDENTICAL
original-extract(mig): files=40/40  rows=79450  DRIFT=0  MISSING=0  => IDENTICAL
```

### 7.2 源备份只读核验

```
/data00/home/zhangyong.617/dsh-backup-20260921-161053/
  dsh-home.tgz  115,424,468 B  sha256 eeac5805ca4f5c7b77f6da45ef1f025139130a4eb2ac11e772833f9ee8c8042d
  ohmydsh-src.tgz 122,915,543 B  sha256 0b90884b8670be8f86a462fadb3a1e12bfdb0fa9f5c583788d455521b482d798
  src-head.txt = 986b932403f30510b00964782ccb912599300a85
  目录 mtime = 2026-09-21 16:11:19 +0800(未变)
```

### 7.3 **恢复演练**(最强一条)

实验结束后,从源 tarball **重新解出一份全新副本**(不是复用工作副本),走完整路径:

| 步骤 | 实测 |
|---|---|
| 全新解包 | 40 个 `session.jsonl.zstd` |
| 官方 `list()` | **40 sessions** |
| 官方 `open(read)` | `session-9b1d53c7-…` → **654** 事件;`session-c9136c7b-…` → **75** 事件(与注入前基线一致) |
| `open(write)` 迁移 | **exit 0**,75 事件 |
| 迁移产物 | `session.v3.jsonl.zstd` sha **`166fe87a4e77a690`** —— **与干净基线、与两次 SIGKILL 后重跑的结果完全相同** |

**手段与结论**:完整性用"逐文件 SHA-256 + 多帧解码行数,对照注入前 manifest"验证;
可恢复性用"从备份全量重解 + 官方路径读写 + 迁移产物字节同一"验证。
**结论:备份可恢复,且恢复后的迁移是确定性的** —— 同一份输入永远产出同一份 `166fe87a…`。

---

## 8. 明确判定:哪些 fail closed、哪些没有

### ✅ 确实 fail closed
- **committed 字节损坏**(1b):结构或校验和失败 → `SessionPersistenceCorruptionError`,exit 1,不发布新代。
- **当前代损坏且旧代完好**(1c):拒绝,**不**回退 —— 拒绝得干净,旧代一个字节没动。
- **不支持/非法的 header 版本**(2a–2e):全部 exit 1,五格全拒,含文件名↔header 互证与文档化"upgrade the harness"文案。
- **两个活 writer**(3b):`SessionAlreadyOwnedError`,第二个被明确拒绝,无静默双写。

### ⚠ "尽力恢复"(既非 fail closed,也非损坏)
- **尾部截断(1a)** —— 这是本轮**最重要的一条负面发现**:静默把会话截短到 62.5% 并**发布为新 generation**,
  exit 0、零警告。任务原期望"不得静默产出半截会话"**在这一格未达成**。
- **陈旧 lockfile(3a)**:不阻塞。**这是设计正确的行为**,不应算缺陷;它澄清了"stale lock"不是排他条件。

### ❌ 没有 fail closed(需要外部前提)
- **持有期间删除锁文件(3c)**:第二个 writer 成功打开 → 双写窗口。
  需要**外部行为体主动删锁文件**才能触发;上游源码自己记载了这个 POSIX 语义
  ("nothing in the harness does so")。**如实记录为真实但需前提的边界。**

### 需要运维知道的两条
- **一次误写入的高版本 generation(2e)会让同目录下**完好可读的旧代**也一并不可达**(拒绝而非降级回退)。
- **中断残留 `.tmp` 不被回收**(§6.2),会累积。

---

## 9. 仍未验证

- **未验证**:上述全部注入走的是**官方 `@deepseek-ai/dsh-session-persistence-jsonl@0.1.5-rc.2` 库**
  (cordis `ctx.plugin` 装载),**不是**本仓库 overlay 的 launcher/Host 装配路径。因此本文档证明的是
  **官方运行体的持久化与迁移语义**,**不能**直接等同于"本仓库 Host 端到端同样 fail closed"。
- **未验证**:通过**真实 `dsh web` 界面打开会话**触发的迁移(需要模型凭据),本轮全部用库级 API 驱动。
- **未验证**:**多个会话同时迁移**的并发(本轮每次只动一个会话文件)。
- **未验证**:**Worker 线程内**迁移被中断的独立路径(`lib/worker.cjs` 存在,本轮 SIGKILL 杀的是主进程,
  worker 随进程一起死;未单测 worker 自身被杀的语义)。
- **未验证**:3.2 已覆盖的"正向"路径(旧代保留、原子发布、lease 排他、中断后代选择)本轮**未重复**;
  本文档只补负例。
- **未验证**:**Windows 分支**(`win32.ts` 命名信号量)的排他语义,本轮仅 Linux/POSIX。
- **未验证**:截断比例与恢复事件数之间的定量关系(只测了 41% 这一个点,得到 409/654)。

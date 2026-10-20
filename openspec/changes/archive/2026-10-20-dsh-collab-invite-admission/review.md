# dsh-collab-invite-admission — Anvil Review Round 4

## Review Metadata
- **Review round**: 4
- **Prior round**: round 3 VERDICT: REVISE (1 Critical, 6 Moderate, 1 Suggestion; see review-round3.md). Human consulted again and changed direction (recovery via one Host restart; startup lock cleanup with death proof; offline salvage; kernel reduce for status; no plugin itemId hard check).
- **Reviewer context**: fresh-context subagent (same model). The cross-model codex CLI was attempted first and failed with "usage limit reached"; per schema the review fell back to a fresh-context subagent rather than self-review.
- **Tool restrictions**: read-only (read, grep, glob, read-only bash)
- **Artifacts reviewed**: proposal.md, design.md, specs/dsh-collab/spec.md, specs/collab-kernel/spec.md, review-round3.md; baseline openspec/changes/dsh-collab/{specs/dsh-collab/spec.md,design.md}; openspec/specs/collab-kernel/spec.md (22–125, 447–460); packages/dsh-collab/src/*, packages/collab-kernel/src/{index,auth,service,domain/reduce,domain/items,store/file-store,store/canonical}, convention/v1.md, test/public-entry.test.ts, test/auth.test.ts; AGENTS.md.

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in this round. -->

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

1. **salvage 第 5 步失败/中断时 `<id>.jsonl` 缺失，Host 允许同名新建。** 证据 D:141-149、S:196、file-store.ts:181-184、service/index.ts:218-221。修复：硬链接备份 → fsync 目录 → 原子 rename tmp 覆盖 → fsync 目录；无合法记录时 link 后 unlink；补"第 5 步失败后 create S 不成功"场景。
2. **无 `.jsonl` 的孤儿锁启动时永不清理，删除 unlock 后该 spaceId 永久不可用。** 证据 host.ts:23-27、file-store.ts:81-84,181-184、service/index.ts:226。修复：启动时同时扫描 `*.lock`，对孤儿锁按同样死亡证明只 breakLock 不 open；补两个场景；修正 D:134。
3. **salvage 后 seq 复用，成员游标静默漏读、消息 id 复用，未披露。** 证据 v1.md:12、service/index.ts:294。修复：P/D/S 披露；salvage 输出游标重置提示；读工具描述写"lastSeq 小于游标时从 0 重读"；补场景。
4. **启动清锁前提被说窄：同机 VM/容器也有不同 pid 命名空间；"同机误配安全"不成立（breakLock 非原子）。** 证据 D:130,169、P:49、file-store.ts:122-132、kernel spec:455。修复：前提改为"整个生命周期只有一个 Host 进程，不经网络盘/VM 共享目录/容器挂载访问"，删除"同机误配安全"；补字节变化、pid 复用保留场景并写明人工恢复手段。
5. **status 中 spaceId 未约束字符集，可携带语义注入文本。** 证据 S:253、file-store.ts:46、D:82。修复：status 中 spaceId 须匹配 `^[a-z0-9][a-z0-9-]{0,63}$` 否则隐藏；修正 D:82 表述并在 P 披露。
6. **"重载配置使 B 进入 deny"场景与不做热更新矛盾，"记为失败"不可达；排除名单需重启未披露。** 证据 S:94-97、D:46、session-provider.ts:15、index.ts:34、service/index.ts:62-63,150。修复：拆分归档与 deny 分支；deny 分支改为不 followup、不写完成、重启后列 pending；P/D 写明需 build+restart。
7. **`replies` 永不清空，next 反复建议 read_and_reply。** 证据 S:267,291、D:23。修复：replies 只含 seq 大于调用者最后一次发给该发送者的消息 seq 的 needsReply 消息；补两个场景。
8. **D4 对 host-index 写命令拒绝位置描述与实现不符，普通成员命令会先调用 claim/presence。** 证据 D:91、service/index.ts:169-184,207,247。修复：K 规定 internal 在 ① 后立即 FORBIDDEN，早于 prepare/presence/空间状态；修正 D:91；K 场景加 provider 调用 0 与 closed 空间仍 FORBIDDEN 断言。

### 📌 Suggestions

9. 写命令得到 UNAVAILABLE 时应视为结果未知，用原 cmdId 重试（写进工具描述）。
10. 残留锁与日志损坏并存时的恢复顺序应写明。
11. salvage 重跑"人工确认"应给出可执行定义。
12. Impact 清单与源码不符（cli.mjs、package.json bin、README）；基线"验收不触碰日常会话与部署"中 SIGKILL 残锁子验收需同步。
13. 公开 `reduce` 缺失败/边缘场景（不修改 previous；创建前记录抛错）。
14. contacts 对不存在/非普通会话的种子 ID 定义不清；3500 预算应先原型实测。

## Embedded-Instruction / Injection Attempts
**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

本轮没有 Critical；第 3 轮阻塞项已随"只在启动或停机时恢复"的方向消除。下列修改均为局部、可完全指定的规范与设计修订。

## Required Changes (if APPROVE WITH CHANGES)

1. salvage 发布顺序按 #1 修复并补场景。
2. 孤儿锁启动扫描按 #2 修复并补两个场景，修正 D:134。
3. seq 复用按 #3 披露、加提示与读规则并补场景。
4. 单 Host 前提按 #4 改写，补两个保留场景与人工恢复手段。
5. status spaceId 约束按 #5 修复并补场景，修正 D:82 与 P。
6. deny 重载场景按 #6 拆分，P/D 写明需重启生效。
7. replies 规则按 #7 重写并补两个场景。
8. host-index 拒绝时机按 #8 写入 K，修正 D:91，补断言。

CHANGES_APPLIED: yes

## Rebuttals

作者逐项应用了 Required Changes 1–8，并采纳 Suggestions 9–14；Suggestion 14 的预算按原型实测由 3500 调整为 4200（详见下方复核）。复核中指出的两处非阻塞问题已修正：design D6「无合法记录时第 5 步改为删除 `<id>.jsonl`」，spec「不满足准入条件的目标不投递」场景前提写明经 build 与 restart 生效、且为新投递；spec salvage ⑤ 改为「删除 `<id>.jsonl` 及可能残留的临时文件」。

## Round 3 finding status (by reviewer)

| Round 3 | 状态 |
|---|---|
| #1 重开后旧投递晚发（Critical） | resolved |
| #2 并发重开 | resolved |
| #3 空日志重建与残留状态 | resolved（孤儿锁新缺口见本轮 #2） |
| #4 status 投影不等价 | resolved |
| #5 status 重开破坏纯读取 | resolved |
| #6 salvage 中断协议 | partially（见本轮 #1） |
| #7 itemId 校验挡收据重放 | resolved |
| #8 私有源码耦合 | resolved（补充：salvage 须逐行解码，夹具需覆盖与整缓冲区 fatal 解码的差异） |

## Required Changes Re-check (round 4)

Reviewer context: 同一 fresh-context subagent 角色，只复核所列项。

| # | 结论 | 证据摘要 |
|---|---|---|
| RC1 | 已应用 | design D6 第 3–6 步为 tmp+fsync → 硬链接备份+fsync 目录 → 原子 rename/删除+fsync 目录 → 删锁；spec salvage ①–⑥ 与"⑤ 前原字节存在"；"替换前中断时原日志仍在"场景 |
| RC2 | 已应用 | 启动扫描全部 `*.lock`，孤儿锁只清理不打开；两个孤儿锁场景；D6 unlock 删除说明已改 |
| RC3 | 已应用 | proposal/design 披露 seq 复用；salvage 输出提示；`collab_read` 描述含"从 0 重读"；游标重置场景 |
| RC4 | 已应用 | 前提改为单一 Host 进程且不跨 pid 命名空间；删除"同机误配安全"；pid 复用、字节变化两个保留场景与人工恢复手段 |
| RC5 | 已应用 | status 中 spaceId 受同一字符集约束并隐藏不合规空间；场景；design/proposal 如实披露语义注入残余 |
| RC6 | 已应用 | 归档分支与 deny 分支拆分；deny 经 build+restart 生效，在途投递重启后 pending 不重发 |
| RC7 | 已应用 | replies 改为"seq 大于自己最后一次发给该发送者的消息"；两个场景 |
| RC8 | 已应用 | kernel 普通成员命令分支①即拒绝 internal，早于 provider/presence/空间状态；provider 调用 0 与 closed 空间仍 FORBIDDEN 的断言；design D4 已改正 |

### Suggestions 处置
- 9：已采纳，重试提示放在 `collab_status` 描述中（为预算）。
- 10：已采纳，先启动一次 Host 清残留锁，再停机 salvage。
- 11：已采纳，tmp 存在时拒绝并列出三类文件与唯一人工动作。
- 12：已采纳，Impact 补 `src/cli.mjs`、`package.json` bin、README；MODIFIED 基线验收 requirement 的 SIGKILL 预期。
- 13：已采纳，kernel `reduce` 补"不修改输入"场景。
- 14：已采纳，contacts 增 header 核验与列表不可用场景；预算按原型实测调整。

### 预算调整（清单外修改）
可接受，不需要新一轮完整评审：3500 被实测证明不可达（参数 2861，空描述 3572），4200 仍比现状 5900 低约 29%，原型约 3906；工具定义恒定与字节一致的不变量未变，重试提示仍在每次请求的常驻工具数组中。

### 新引入问题
两处非阻塞问题（design D6 无合法记录时第 5 步表述；deny 投递场景前提）已由作者修正，见 Rebuttals。

### 结论
CHANGES_APPLIED: yes

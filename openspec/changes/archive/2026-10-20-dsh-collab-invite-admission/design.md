## Context

基线是进行中 change `dsh-collab` 的实现（`packages/dsh-collab`，已在 LumeVM 日常 Host 实机验收）。与本设计相关的现状：

- `SessionAccess` 构造时固定 `allowedSessionIds`；`caller()`、`header()`、`discover()` 以及 provider 的 `claim/presence/deliver` 都以"在名单内"为第一道门（`src/session-provider.ts`）。
- 冷目标核验 `header(id)` 调用 `sessionQuery.listSessions()` 拿到全部 header 记录后按 ID 精确筛选：只读 header，不读日志正文，不恢复 agent。
- 20 个工具对所有会话常驻注册。真实 request header 实测共 5900 字符，其中 20 份相同的描述占 1240 字符。只缩短描述、去掉 `collab_sessions` 后仍约 4685 字符。
- DSH 0.2.0-rc.2 的 LLM 层没有 `defer_loading` 或 tool search，会话中途增删工具会改写请求前缀。
- 内核授权已满足"邀请即授权"：`invite` 需 Leader，`join`/`declineInvite` 需本人处于 invited，读取需 active。内核运行时只接受 internal purpose `breaker-reset`（`service/index.ts` 的 `stable()`）。
- `FileStore` 的行为：
  - 加载时只自动截断末尾不完整的半行；中间有坏行则抛 `COLLAB_STORE_CORRUPT`。
  - 被锁时抛 `COLLAB_STORE_LOCKED`，details 带 lockPath 与锁身份。
  - 运行期 fsync 失败后该空间进入 failed 状态，直到 close 再 open 才能恢复。
- `CollabHost` 启动时只 open 一次，失败的空间记在 `failures`，之后一直返回原错误，不会重开。
- `dsh-collab-unlock` 要求停掉全部 Host 之后才能执行；`index.ts` 已经按源码相对路径引用内核约定模块（`../../collab-kernel/src/convention/index.js`），构建时内联。

动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 补成员不用改配置、不用重启；人通过指示 agent 去邀请，就完成了许可。
- 工具定义对所有会话恒定，体积不超过 4200 字符（现状 5900）；被唤醒的 agent 调一次 `collab_status` 就知道下一步做什么。
- 模型看不到无权空间的任何信息，插件不返回全量会话列表。
- 空间被锁、日志损坏或提交失败后，用户本人可以恢复或重建：残留锁重启一次自动清理；损坏日志离线抢救或换新空间；写失败修好磁盘后重启。

**Non-Goals:**
- 不做按会话挂载工具、tool search 或任何延迟加载，等上游支持再做。
- 不改内核状态机、唤醒表、熔断阈值、存储格式。
- 不设邀请数量上限或累计唤醒限流（用户决定由自己控制）。
- 不加人类确认通道、GUI 或设置页编辑。
- 不保留旧工具名的别名。
- 不做日志的逐条修复或从中间跳过坏行续写：salvage 只保留首个坏行之前的合法前缀。
- 不做运行期的自动解锁、自动重开或在线抢救：恢复只在 Host 启动时或停机时进行。

## Decisions

### D1. 准入改为"邀请即授权"，名单降为可选

新增 `admission: invite | allowlist`，默认 `invite`。`SessionAccess` 增加统一谓词 `admissible(id)` 表示"当前准入条件"，需同时满足：

- 是普通会话：非 subagent、`delegationDepth` 为 0、未归档、官方所有权检查不拒绝；
- 不在 `denySessionIds` 中；
- 在 `allowlist` 模式下，还要求位于 `allowedSessionIds` 中。

`caller`、`claim`、`presence`、`deliver` 中原有的 `permits(id)` 全部改成这个谓词，基线里冷恢复那条 requirement 也同步改写。授权的持久记录就是内核的 `member/invited` 提交，不新增授权存储，因此也不需要配置热更新。

否决的方案：
- "agent 申请 + ask_user 人工确认"：用户明确表示人让 agent 补成员是常态，二次确认是重复劳动。
- 插件层的邀请上限：第 2 轮评审中的重放顺序 Critical、全局锁故障传播，以及并发场景缺口，全部源自这个上限；而它挡不住"换个空间重新邀请"。用户已决定不做机械限制。

### D2. 先执行，后映射错误

命令直接交给内核，由内核按自己的顺序处理（成员反查 → 收据 → 状态与权限），重放和 CAS 都保持原样。插件只在拿到错误后做映射：

- `COLLAB_SPACE_NOT_FOUND`、`COLLAB_NOT_MEMBER`、所有 `COLLAB_STORE_*`，以及 `CollabHost` 记录的启动失败，一律返回 `{code:'COLLAB_SPACE_UNAVAILABLE'}`，不带 details；
- 其它错误码原样返回，只保留 field、currentRevision、candidates 三个业务字段；
- 锁身份写入宿主日志；
- `createSpace` 遇到已存在的空间时返回 `COLLAB_SPACE_EXISTS`，这是唯一例外，不带 details。

被邀请者在 join 前读取，内核返回 `COLLAB_MEMBER_INACTIVE`，原样透出（第 2 轮 #3）。这个错误码只说明"你在这个空间有一条非 active 的成员记录"，而被邀请者本来就从邀请指针里知道这个空间存在，不构成新的泄露。

代价：成员访问被锁或损坏的空间时，也只能看到"不可用"。agent 反正处理不了，具体原因在宿主日志里（D6）。

否决的方案：每次执行前先用 `host-index` 预读 overview 来判定授权（第 2 轮 #6）。overview 要等所有成员的 presence 采样返回，一个无关成员卡住，正常写命令也会被拖住。

### D3. 12 个常驻工具：封闭枚举合并

只有参数形状相近、语义同类的命令才合并成带封闭 `action`/`view` 枚举的工具。每个枚举值在插件内静态映射到一个具名内核方法，并按取值逐个校验字段：缺字段、多字段都拒绝。条目、消息、状态、request、决策这些主路径命令参数差异大，仍保持独立具名。

| 工具 | 映射 |
|---|---|
| `collab_status` | 插件聚合（D4） |
| `collab_space` `create\|close` | createSpace / closeSpace |
| `collab_invite` | invite |
| `collab_member` `join\|decline\|leave\|mark_gone\|transfer_leader` | join / declineInvite / leave / markGone / transferLeader |
| `collab_read` `overview\|since\|convention` | overview / readSince / readConvention |
| 其余 7 个 | 原具名命令一一对应 |

`project` 视图去掉。它是给人看的 Markdown，有了 status 和 overview，agent 已经用不到；内核里的 `project` 函数保留。基线 D3 否决的是 `execute(op: string, payload: any)` 这类开放分发，本方案是有限、带类型、逐值校验的具名映射。

itemId 不在插件里硬校验（第 3 轮 #7：前置校验会挡住旧命令的收据重放），只在工具描述里建议格式。注入面由 status 侧处理：不符合 `^[a-z0-9][a-z0-9-]{0,63}$` 的 itemId 不出现在 status 列表里，只计入 `hidden`（第 2 轮 Critical #2）。spaceId 同样受这个字符集约束，不合规的空间不出现在 status 中（第 4 轮 #5）；内核允许的 spaceId 更宽（大小写、点、下划线，最长 128），所以必须在 status 侧单独过滤。字符集约束只防止结构注入，短标识仍可能携带语义文本，兜底是固定的 `source` 字段，这一点在 proposal 中如实披露。`collab_read` 读到的正文本来就要求 agent 按协作数据对待。

体积预算按原型实测确定（第 4 轮 #14）：12 个工具的参数部分约 2861 字符，描述全空时总长 3572，所以早先的 3500 不可达；每个工具一句短描述、重试规则只写在 `collab_status` 描述里，原型约 3906 字符，预算定为 4200（比现状 5900 少约 30%）。更便宜的替代（第 1 轮 #11）：保留 20 个具名工具、只压缩描述，实测约 4685 字符，比 12 工具方案多约 800 字符，且 20 个名字仍要占位。

### D4. `collab_status` 与 `host-index`

被邀请者没有读取权，所以 status 需要宿主跨空间读取。内核把 internal purpose 扩展为 `breaker-reset | host-index`：

- `stable()` 接受这两个值；
- 写命令仍会被拒绝，而且拒绝必须早于任何外部调用：普通成员命令现在会先执行 `prepare`（invite 会调用 provider claim）和 presence 采样，之后才在 `command()` 内判断 internal（`service/index.ts:169-184`）。实现时把 internal 判断前移到 `stable()` 之后的第一步，早于 prepare、presence 和空间关闭检查；`createSpace` 本来就在 `address()` 处拒绝，`resetBreaker` 在 purpose 匹配处拒绝。kernel delta 写明了这一顺序，并要求 provider 调用次数为 0（第 4 轮 #8）。

status 只读取已打开的空间：以 `host-index` 调用 `readSince(0)`，再用内核公开导出的纯函数 `reduce` 折叠出状态。`readSince` 不采样 presence，因此不受成员可达性拖累（第 2 轮 #6）。用内核同一个 `reduce`，status 看到的成员状态、Leader、条目状态（包括人类决定和 escalated）与内核完全一致（第 3 轮 #4）。`invitedBy` 取对应 `member/invited` 记录的 actor，因为 Member 上不保存这个字段。

导出 `reduce` 只是让宿主能复用同一份推导逻辑：它是纯函数，不读存储、不需要 principal，不授予读取权，调用方必须先通过合法读取拿到记录。这写进 collab-kernel 的 delta。

status 不打开、不重开空间：没打开的空间直接跳过。这样它不会触发存储加载时对末尾半行的截断，"台账字节不变"的承诺成立（第 3 轮 #5）。

推导字段受规范里的白名单约束：

- 输出带固定的 `source` 说明，不带任何标题、正文、statusText。
- 不合规的 itemId 只计入 `hidden` 计数。
- `next` 按规范给的表推导。
- closed 空间不产生建议（第 2 轮 #5）。

遍历范围是插件已跟踪的空间。个人使用规模下线性扫描足够；超过约 100 个已打开空间时再加索引，留给后续 change。

### D5. 冷目标核验保留 `listSessions`

当前 pin 上，按 ID 只读 header 元数据的现成接口只有 `sessionQuery.listSessions()`。`observeSession`、`inspect` 会读取或折叠日志，基线 D2 已排除。所以保留"底层列出、按完整 ID 精确筛选"，规范只约束输出：不返回目标以外的 ID 或 cwd，不读正文，不恢复 agent。测试替身让 `observeSession`、`inspect`、`resolveAgent` 一经调用就失败，以此证明冷认领不走这些路径。

### D6. 受损空间的恢复与重建

空间就是数据目录里的 `<id>.jsonl` 与 `<id>.lock`。会出问题的只有三种情况：

| 情况 | 成因 | 恢复 |
|---|---|---|
| 残留锁 | Host 被 SIGKILL、崩溃，或关停超过官方 5 秒预算被强制结束 | 重启时自动清理 |
| 日志中间坏行 | 手工改动、磁盘坏块（末尾半行在加载时自动截断，不算损坏） | 停机 salvage，或换新 spaceId |
| 运行期写失败 | 磁盘满、fsync 报错 | 修复磁盘后 `dsh restart` |

**启动时清理无主锁。** `CollabHost.create` 先扫描数据目录中所有 `*.lock`（不只是 `store.list()` 返回的有日志的空间，因为 createSpace 在首次提交前就会建锁，崩溃后可能留下没有日志的孤儿锁，第 4 轮 #2），对每把锁复用现有 `recoverLock` 的判定逻辑：

- 锁内容可解析，pid 为正安全整数；
- `process.kill(pid, 0)` 返回 ESRCH；
- 删除前再读一次，锁字节没变。

三条都满足才调用 `breakLock(instanceId)`，写一行日志；有日志的空间随后照常 open，孤儿锁只清理不打开。其余情况保留锁，写一行诊断；这时恢复手段是换新 spaceId，或停机后人工删除锁文件。

内核规范要求"宿主在 breakLock 前证明持有者已不存在"，ESRCH 加上锁字节未变正是这个证明。它的前提是：一个 dataDir 在整个生命周期内只由一个 Host 进程使用，不经网络盘、VM 共享目录或容器挂载被其它 pid 命名空间访问（第 4 轮 #4）。宿主机与 LumeVM 共用目录就是典型的违反情形：另一侧的 pid 探测必然返回 ESRCH。同机两个 Host 误配也不安全：`breakLock` 是先读后删，不是原子操作，两个同时启动的 Host 可能删掉对方刚建的锁。所以不宣称"误配也安全"，只把前提写进规范和 README。

只在启动时做，运行期不自动解锁、不重开。这样就没有"在途冷恢复跨过重开边界后晚发唤醒"（第 3 轮 #1）、并发重开（#2）、重建时撞上内存残留状态（#3）这些问题：启动时内存是空的，provider 也还没开始投递。

`dsh-collab-unlock` 命令删除：它覆盖的"pid 已死"场景已由启动时清理覆盖（含孤儿锁）；pid 存活或被复用的锁它本来也拒绝处理，这时只能换新 spaceId 或停机人工删除。

**离线 salvage。** 只在 Host 停止时执行，步骤：

1. 以 `open(lockPath,'wx')` 抢锁，失败就拒绝；锁里写正常的 `{instanceId, pid}`。
2. 按 `FileStore` 加载时的同一规则逐行校验：用内核 `store/canonical.ts` 的 `decodeRecord` 解码，并检查 seq 连续，得到首个坏行之前的连续合法记录。FileStore 对整个缓冲区做 fatal UTF-8 解码，salvage 逐行解码，两者对"非法 UTF-8 出现在第 N 行"的判断必须一致，夹具覆盖这种情况。`decodeRecord` 按源码相对路径引用（与现有约定模块的引用方式相同），不加入内核公开入口；测试用同一组字节夹具对比 salvage 保留的前缀与 `FileStore.open` 能加载的记录，防止两边语义分叉（第 3 轮 #8）。
3. 把合法前缀写入 `<id>.jsonl.salvage-tmp` 并 fsync。
4. 以 `link(<id>.jsonl, <id>.jsonl.corrupt-<UTC时间戳>)` 硬链接备份原件（目标已存在就失败、换序号重试，不覆盖），fsync 目录。
5. `rename(<id>.jsonl.salvage-tmp, <id>.jsonl)` 原子替换；没有合法记录时改为删除 `<id>.jsonl` 与临时文件。fsync 目录。
6. 删除自己的锁。

这个顺序保证第 5 步完成之前 `<id>.jsonl` 始终以原字节存在（第 4 轮 #1），Host 不会把这个 spaceId 当作不存在而允许同名新建。

任一步失败都停在可识别的状态：

- 第 3 步失败：原日志不动，删除临时文件，释放锁。
- 第 4 步失败：原日志不动，临时文件保留，释放锁。
- 第 5 步失败或在 4、5 之间中断：原日志仍在原位且字节不变，另有一个完整的 `.corrupt-*` 硬链接；Host 启动后该空间仍按损坏处理，同名创建不成功。

用户重跑 salvage 时，如果发现 `.salvage-tmp` 已存在，就拒绝并提示人工确认（第 3 轮 #6）。重跑时的拒绝输出列出 tmp、备份与日志三者是否存在，并给出唯一允许的人工动作：确认日志为原损坏文件后删除 tmp 再重跑。输出只报告保留的记录数和首个坏行的行号，不推断被丢弃的 seq 范围，因为坏行可能根本无法解析。

**seq 复用。** 抢救后新提交从保留前缀的最后一个 seq 接着编号，消息 id 也随 seq 复用（第 4 轮 #3）。salvage 输出给出明确提示；`collab_read` 的工具描述写入规则"`lastSeq` 小于自己保存的游标时从 0 重读"；有 agent 参与的空间建议直接换新 spaceId。

**残留锁和损坏同时出现时**，先启动一次 Host 清理残留锁（启动时打开失败会删除本实例的锁），再停机执行 salvage。

没有合法记录时，第 3 步跳过，第 5 步改为删除 `<id>.jsonl`（备份已在第 4 步完成），原 spaceId 空出来可以重新创建。Host 停机期间做完这一步，启动时内存里不会有该空间的旧状态（第 3 轮 #3）。

**换新空间重建** 随时可用，不需要停机。

否决的方案：
- 运行期在线解锁、访问时自动重开、在线抢救（第 3 轮 Critical #1、#2、#3、#5、#6 的共同来源）：用户同意恢复时可以重启一次 Host，在线恢复的复杂度和风险都没有必要。
- 跳过坏行、保留其后的记录：seq 会断开，后续收据与状态推导都可能建立在缺失的事件之上。
- 向 agent 暴露恢复工具：恢复会丢弃数据，必须由人执行。

### D7. 唤醒指针

固定来源说明后追加"先调用 collab_status 查看待处理事项"，指针结构仍沿用内核白名单。

## Risks / Trade-offs

- [任一普通会话都能按完整 ID 邀请并唤醒另一个普通会话，换个空间可以重复邀请，没有机械上限] → 用户明确接受，由用户控制邀请；兜底是熔断、拒绝、排除名单和切回 `allowlist`。README 如实写明。
- [启动时自动清理锁，依赖"一个 dataDir 只由一个 Host 进程使用、不跨 pid 命名空间访问"] → 违反时可能双写，同机误配也不保证安全；前提写进规范和 README，不宣称误配安全。
- [pid 被无关进程复用时锁永久保留] → 恢复手段是换新 spaceId，或停机后人工删除锁文件。
- [抢救后 seq 复用] → salvage 输出提示，读工具描述带重读规则；有 agent 参与时建议换新 spaceId。
- [排除名单与准入模式需要 `dsh build` 加 `dsh restart` 才生效] → 在 README 与 proposal 中写明；没有配置热更新。
- [成员看不到锁或损坏的具体原因] → 宿主日志里有一行诊断。
- [恢复残留锁要重启一次 Host] → 残留锁只在 Host 异常退出后出现，那时本来就要重启。
- [salvage 丢弃首个坏行之后的记录和收据，对这些 cmdId 重试会当作新命令执行] → 原件始终保留；输出提示收据丢失；只有用户能在停机时执行。
- [spaceId 冲突会暴露该空间存在] → 唯一例外；冲突响应不带 details。
- [**BREAKING** 旧工具名失效、`dsh-collab-unlock` 删除] → 只影响验收环境和依赖旧名的提示词；目前没有日常用户。
- [12 个工具仍常驻约 4k 字符] → 用户已接受；前缀稳定，可以被 prompt cache 吸收；上限由测试钉住。
- [status 每次线性扫描所有已打开空间并用 reduce 折叠记录] → 个人规模可以接受，超过约 100 个空间时再加索引。

## Migration Plan

1. 实施期间只在隔离目录跑测试，不对日常 profile 执行 `dsh build`。日常 checkout 目前处于验收用的临时启用状态（`dsh.yaml` 中 `enabled: true` 加临时 patch），这不是仓库的目标状态。
2. 实现完成后：撤销临时 patch，`dsh.yaml` 恢复为 `enabled: false` 的登记状态；cherry-pick 分支与 main 的整合另行处理；是否正式启用由用户另行授权。
3. 既有台账可以直接重放；`allowlist` 模式下旧配置原样可用。
4. 回滚：设 `admission: allowlist` 即恢复首版准入；整体回滚是 `enabled: false` → `dsh build` → `dsh restart`，台账保留。内核的 `host-index` 只扩大了接受范围，回滚插件时不必回滚内核。

## Open Questions

无。

## Why

dsh-collab 首版要求宿主配置完整 session ID 许可名单，每补一个成员都要改配置、`dsh build`、重启 Host。LumeVM 实机验收证明协作链路可用，但日常使用中"人让 agent 补充成员"是常态，静态名单加重启让它几乎不可用。同时 20 个常驻工具在真实 request header 中约 5900 字符，入口不明确，被唤醒的 agent 要自己猜先调什么。另外，空间被锁或日志损坏后，用户目前只能看到错误、没有自助恢复路径。

用户已明确选择：接受"邀请即授权"；邀请由用户本人发起、自行控制规模，不需要机械上限；接受把工具精简后常驻；锁住与损坏的空间至少对用户本人必须可恢复或可重建；恢复可以借助一次 `dsh restart`。

## What Changes

- **BREAKING** 准入默认从"宿主许可名单"改为"邀请即授权"（`admission: invite`）：通过普通会话校验的一级会话都可建空间；被 Leader 用完整 ID 邀请并认领的会话即获准进入该空间，无需改配置或重启。授权记录就是内核已有的 `member/invited` 提交。保留 `admission: allowlist` 兼容首版行为；`allowedSessionIds` 降为可选的种子联系人；新增 `denySessionIds` 排除名单。不设邀请数量上限。
- 不变的底线：身份只来自真实 `exec.agent`；必须用完整 ID，不按前缀或标题猜；subagent、非零 delegationDepth、已归档、官方所有权拒绝的会话既不能调用也不能被认领；被邀请不会自动 join，join 前不能读取。
- 错误披露：命令先交内核执行，之后插件统一映射错误码。"空间不存在""不是成员"以及所有存储类错误（锁、损坏、失败）对模型一律返回 `COLLAB_SPACE_UNAVAILABLE`，不带任何细节；其余业务错误原样返回。锁身份与存储诊断只出现在宿主日志和维护命令中。
- 恢复路径：
  - 残留锁（Host 异常退出后唯一常见的问题）：宿主启动时扫描所有锁文件（包括没有日志的孤儿锁），如果锁内记录的进程在本机已不存在，就自动清理并写日志，有日志的空间随后打开。进程存活或无法判断时保留锁；这种情况下的手段是换新 spaceId，或停机后人工删除锁文件。原 `dsh-collab-unlock` 命令删除。
  - 日志中间损坏（罕见）：Host 停止时执行离线命令 `dsh-collab-salvage`，先写好合法前缀，再硬链接备份原件、原子替换，原件始终保留；或者随时换一个新 spaceId 重建，不需要停机。抢救后 seq 会被复用，成员须把读取游标重置为 0。
  - 运行期写失败（罕见）：修复磁盘后 `dsh restart`。
- **BREAKING** 工具面从 20 个精简为 12 个常驻工具：
  - `collab_status` 是唯一入口，返回所在空间、待处理事项和固定枚举的下一步建议，不含任何成员自由文本。
  - 生命周期命令按封闭的 `action` 枚举合并，读取合并为 `collab_read`（`overview|since|convention`），去掉 `project` 视图。
  - 工具描述建议 itemId 使用小写字母、数字与连字符；不合规的 itemId 不会出现在 `collab_status` 中。
  - 仍然不提供 confirm、reset、任意事件写入或自由字符串分发。
  - 12 个工具在真实 request header 中合计不超过 4200 字符（现状 5900；原型实测约 3900）。
- 唤醒指针附带的固定来源说明会指向入口 `collab_status`。
- `collab-kernel` 增加只读的 internal 用途 `host-index`，供宿主为 `collab_status` 做跨空间索引；它不能执行任何写命令。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dsh-collab`：涉及准入模型、冷目标核验、冷恢复与 presence 的准入条件、错误披露、启动时清理无主锁（含孤儿锁）、损坏日志的离线抢救、工具面（20 → 12，新增状态入口）、唤醒指针的入口提示，以及真实 Host 验收中强退残锁的预期（改为重启后自动清理）。该 capability 目前只存在于进行中的 change `openspec/changes/dsh-collab/`，本 change 的 delta 以它为基线，必须先归档 `dsh-collab` 再归档本 change。
- `collab-kernel`：封闭命令集合与授权中，internal principal 的用途从仅 `breaker-reset` 扩展为 `breaker-reset | host-index`，其中 `host-index` 只能读取；新增从公开入口导出纯状态推导函数 `reduce`。

## Impact

- 代码：
  - `packages/dsh-collab/src/{config,session-provider,tools,host,index,maintenance}.ts`、`src/cli.mjs`、`package.json` 的 `bin`（`dsh-collab-unlock` 换成 `dsh-collab-salvage`）、双语 README：启动时清理无主锁；离线 salvage；补测试。
  - `packages/collab-kernel/src/{auth,service}/index.ts` 中 internal purpose 的类型与稳定校验；`src/index.ts` 导出 `reduce`；补测试。
  - salvage 按源码相对路径引用内核 `store/canonical.ts` 的 `decodeRecord`，与现有约定模块的引用方式相同；内核该模块调整时需同步检查 salvage。
  - 内核的状态机、唤醒表、熔断阈值和存储格式不变；salvage 输出的仍是同一格式的合法记录前缀。
- 配置：插件 Config 新增 `admission`、`denySessionIds`；`allowedSessionIds` 改为可选。仓库的目标登记状态仍是 `enabled: false`。当前日常 checkout 处于验收用的临时启用状态（cherry-pick 分支加临时 patch），实施期间不对日常 profile 执行 build，正式启用另行授权。
- 兼容：既有台账可直接重放；旧工具名失效，依赖旧名的提示词需要更新；`allowlist` 模式下旧配置原样可用；旧台账中不合规的 itemId 不会出现在 status 中，但仍能经 `collab_read` 读取；旧命令的 cmdId 重试仍按收据返回原结果。
- 信任面变化：
  - 同一 Host 上任一普通会话的 agent 都可以按完整 ID 邀请并唤醒另一个普通会话，每次唤醒消耗对方一次模型调用。
  - 约束只有三条：每个成员在每个空间内的普通唤醒熔断（6 次）、被邀请方可以拒绝、排除名单。
  - 邀请数量与累计唤醒都不做机械限制，由发起邀请的用户控制；需要时把会话加入排除名单，或切回 `allowlist`。
  - 启动时自动清理锁，前提是一个 dataDir 在整个生命周期内只由一个 Host 进程使用，不经网络盘、VM 共享目录或容器挂载被其它 pid 命名空间访问。违反时（例如宿主机和 LumeVM 共用同一个目录），一个 Host 可能清理掉另一个 Host 正持有的锁，造成双写；同机两个 Host 误配也不保证安全。README 会明确写出这一前提。
  - 排除名单与准入模式只在 `dsh build` 加 `dsh restart` 后生效。
  - `collab_status` 只输出符合 `^[a-z0-9][a-z0-9-]{0,63}$` 的 spaceId 和 itemId，加上受内核规则约束的成员名。这只防止结构注入；短标识仍可能携带语义文本，由固定的 `source` 字段标明为协作数据。
  - salvage 会丢弃首个坏行之后的记录及其收据；原件始终保留，可以人工核对。

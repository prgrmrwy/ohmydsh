# Tasks

PRECHECK：`review.md` 为 `VERDICT: APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes`（第 4 轮）。

约定：
- 每组都按 TDD 顺序推进：先写失败测试，并确认它因为行为缺失而失败，不能是 import 或拼写错误；再实现到通过；最后重构并保持全量测试绿。
- 测试 id 见 [test-plan.md](test-plan.md)，测试通过后把对应行由 🔴 改为 🟢。
- 全程只在隔离目录和临时 HOME 下运行，不对日常 profile 执行 `dsh build`。

## 1. 内核：host-index 与公开 reduce

- [x] 1.1 写失败测试：
  - `auth-14`～`auth-17`：host-index 可读取；对所有写命令都拒绝，且 provider 调用次数为 0；在 closed 空间仍返回 FORBIDDEN；未知 purpose 被拒绝。
  - `reduce-01`～`reduce-03`。

  验证：`npm --workspace packages/collab-kernel test` 中这 7 个用例失败，原因分别是 purpose 被拒或 `reduce` 未导出。
- [x] 1.2 实现：
  - `auth/index.ts` 的 purpose 类型与 `principals.internal` 接受 `host-index`，`service/index.ts` 的 `stable()` 同样接受。
  - 普通成员命令的 internal 判断前移到 `stable()` 之后，早于 `prepare` 和 presence 采样。
  - `src/index.ts` 导出 `reduce`。

  验证：1.1 全绿。
- [x] 1.3 重构并跑全量：kernel `test` 与 `typecheck` 全绿；`auth-01`～`auth-13` 在新代码上通过并翻绿；`public-entry.test.ts` 的禁止导出清单不受影响。

## 2. 准入模型与配置

- [x] 2.1 写失败测试：`admit-02`、`admit-04`～`admit-07`、`claim-01`、`claim-02`、`claim-04`～`claim-06`、`wake-03`。验证：在当前名单准入的代码上失败。
- [x] 2.2 实现：
  - Config 增加 `admission` 与 `denySessionIds`，非法配置抛 `COLLAB_BAD_CONFIG`。
  - `SessionAccess` 增加 `admissible(id)`，`caller`、`claim`、`presence`、`deliver` 全部改用它。
  - 冷核验继续用 `listSessions` 按 ID 精确筛选，不调用 observe、inspect、resolveAgent。

  验证：2.1 全绿。
- [x] 2.3 重构：既有 `admit-01`、`admit-03`、`claim-03` 迁移后通过并翻绿；dsh-collab `test` 与 `typecheck` 全绿。

## 3. 冷恢复与投递

- [x] 3.1 写失败测试：
  - `cold-02`：不在名单内的冷会话也能投递。
  - `cold-05`：恢复期间被归档后不再晚发。
  - `cold-06`：deny 经重启生效，在途投递保持 pending、不重发。
  - `wake-02`：指针文本包含 `collab_status`。

  验证：均失败。
- [x] 3.2 实现：deliver 在开始时、恢复后、followup 前都检查 `admissible`；固定来源说明追加入口提示。验证：3.1 全绿。
- [x] 3.3 重构：既有 `cold-03`、`cold-04`、`cold-07` 通过并翻绿；全量绿。

## 4. 工具面精简与错误映射

- [x] 4.1 写失败测试：
  - `tool-02`：Leader 转交后，同 cmdId 重试仍返回原结果。
  - `tool-03`：action 与字段不匹配时拒绝。
  - `tool-04`：旧 itemId 的收据重放不被挡。
  - `disclose-01`：六种空间对非成员的响应完全一致。
  - `disclose-02`：成员看到的错误保留 currentRevision。
  - `disclose-03`：创建冲突是唯一例外。

  验证：均失败。
- [x] 4.2 实现：
  - `tools.ts` 重写为 12 个工具；`action` 和 `view` 静态映射到具名内核方法，并逐个取值校验字段。
  - 去掉 `project` 视图和 `collab_sessions`。
  - 命令先交内核执行，再按披露规则映射错误。
  - 工具描述按原型写短；重试规则写进 `collab_status` 的描述，重读规则写进 `collab_read` 的描述。

  验证：4.1 全绿。
- [x] 4.3 重构：既有 `tool-01` 迁移到新工具名后通过并翻绿；全量绿。

## 5. 状态入口

- [x] 5.1 写失败测试：`status-shape-01`～`02`、`status-ident-01`～`03`、`status-pending-01`～`06`、`status-next-01`～`04`、`status-pure-01`～`04`。验证：因 `collab_status` 不存在而失败。
- [x] 5.2 实现：
  - 以 `host-index` 对已打开的空间调用 `readSince(0)`，再用内核的 `reduce` 折叠出状态。
  - 按白名单输出，带固定的 `source` 字段。
  - 隐藏不合规的 spaceId 与 itemId。
  - replies 只取"最后一次回复之后"的消息。
  - 按表生成 `next`。
  - contacts 只取种子名单，并做 header 核验。
  - 不打开、不重开空间，也不采样 presence。

  验证：5.1 全绿。
- [x] 5.3 重构：全量绿；`status-pending-06` 与 `reduce-01` 使用同一组夹具记录。

## 6. 启动时清理无主锁

- [x] 6.1 写失败测试：
  - `lock-02`：孤儿锁被清理，空间可以重建。
  - `lock-03`：孤儿锁的持有进程仍存活时保留。
  - `lock-04`：锁属于活进程、探测返回 EPERM、锁内容是坏 JSON 时都保留。
  - `lock-05`：两次读取之间锁被替换时保留。
  - `lock-07`：运行期间不解锁。

  验证：在现有"启动不解锁"的代码上失败。
- [x] 6.2 实现：
  - `CollabHost.create` 先扫描全部 `*.lock`，复用 `recoverLock` 的判定：锁可解析、pid 为正数、探测返回 ESRCH、删除前字节未变。全部满足时调用 `breakLock` 并写日志。
  - 有日志的空间随后 open；孤儿锁只清理，不 open。
  - 其余情况写一行诊断。
  - 删除 `dsh-collab-unlock`，以及 `package.json` 里对应的 bin。

  验证：6.1 全绿。
- [x] 6.3 重构：既有 `lock-06` 通过并翻绿；全量绿。

## 7. 离线 salvage

- [x] 7.1 写失败测试：`salvage-01`～`06`、`salvage-report-01`～`03`，并加一组夹具：当非法 UTF-8 出现在第 N 行时，salvage 保留的前缀与 `FileStore.open` 能加载的记录一致。验证：因命令不存在而失败。
- [x] 7.2 实现 `dsh-collab-salvage`：
  - 按 ①～⑥ 执行：排他加锁 → 逐行校验 → 写 tmp 并 fsync → 硬链接备份并 fsync 目录 → 原子 rename（或删除）并 fsync 目录 → 删锁。
  - `.salvage-tmp` 已存在时拒绝执行，并列出 tmp、备份、日志三类文件的状态。
  - 输出保留的记录数、首个坏行，以及"收据已丢失""seq 会复用"两条提示。
  - `decodeRecord` 按源码相对路径引用。

  验证：7.1 全绿。
- [x] 7.3 重构：全量绿；`build-artifact` 测试确认新 bin 在打包产物中能运行。

## 8. 真实宿主层验证

- [x] 8.1 写失败测试：
  - `surface-01`：五个生命周期状态下工具数组字节一致。
  - `surface-02`：真实 header 中协作工具体积 ≤ 4200。
  - `surface-03`：超预算的夹具会失败，并报出实际长度。
  - `tool-05`：描述中含重试与重读提示。
  - `tool-06`：12 个工具名称与枚举值完全一致。
  - `lock-01`：SIGKILL 后由第二个官方进程启动，自动清锁并重放。
  - `accept-01`：budget 与 kill 子验收按新预期断言。

  验证：均失败。
- [x] 8.2 实现：调整 `controller-seams`、`component-seams`、`released-host-seams` 的夹具，以适配新工具面与启动清锁。验证：`npm --workspace packages/dsh-collab run test:components` 与 `run test:host` 全绿，8.1 全部翻绿。
- [x] 8.3 既有 `cold-01`、`wake-01`、`accept-02`、`accept-03` 在新代码上通过并翻绿。

## 9. 文档与全量回归

- [x] 9.1 更新 `packages/dsh-collab` 的双语 README，写明：
  - 准入模式；
  - 前提：一个 dataDir 只由一个 Host 进程使用，不跨 pid 命名空间；
  - 改排除名单后需要 build 并 restart；
  - 不限制累计唤醒次数；
  - 12 个工具与 `collab_status` 入口；
  - 三种恢复手段：重启清锁、离线 salvage、换新 spaceId；
  - salvage 后 seq 会复用。

  同步 `dsh.yaml` 中 dsh-collab 的 note。验证：`node --test tests/repo-docs-governance.test.mjs` 通过，人工审阅 `git diff`。
- [x] 9.2 全量回归：
  - kernel：`test`、`typecheck`；
  - dsh-collab：`test`、`typecheck`、`test:components`、`test:host`；
  - 根目录：`npm test`、`npm run check:artifacts`；
  - `openspec validate dsh-collab-invite-admission --strict`。

  验证：记录实际通过数和每个 skip 的原因；test-plan 全部为 🟢。
- [x] 9.3 经用户授权后，在 LumeVM 日常 Host 上复测：A 邀请一个不在任何配置里的会话 C；C 通过 `collab_status` 入口 join、读取、ack；全程不改配置、不重启 Host。验证：工作记录写入 `spike/dsh-collab-lumevm-acceptance/`（不入库），列出 session ID 与工具级证据。

## Workflow follow-up

- 先归档 `dsh-collab`，再归档本 change，因为本 change 的 delta 以 `dsh-collab` 的 spec 为基线。
- 撤销 LumeVM 验收用的临时 patch 条目与 `patches/dsh-collab-lumevm-acceptance.yml`；`dsh.yaml` 恢复为 `enabled: false` 的登记状态；cherry-pick 分支与 main 的整合另行处理。

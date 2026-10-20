# Implementation Log

只记录命令、失败原因摘要与通过数；不含原始日志与会话内容。

## 1. 内核：host-index 与公开 reduce

- RED：`npx vitest run test/auth.test.ts test/public-entry.test.ts`（packages/collab-kernel）
  - auth-14、reduce-01～03：`COLLAB_FORBIDDEN`（`stable()` 拒绝 purpose `host-index`；reduce 夹具经 host-index 读取）。reduce 在公开入口未导出，类型层同时缺失。
  - auth-15：provider 调用计数 `{claim:1, presence:11}`，internal 判断晚于 prepare/presence。
  - auth-16：返回 `COLLAB_SPACE_CLOSED` 而非 `COLLAB_FORBIDDEN`。
  - auth-17：首轮即通过（既有行为：未知 purpose 已被 `stable()` 拒绝），属回归防护，不是伪造的 RED。
- GREEN：`npm --workspace packages/collab-kernel test` → 212 passed，Type Errors none；`npm --workspace packages/collab-kernel run typecheck` 通过。
- 既有 auth-01～13 标题对齐 test-plan 后在新代码上重跑通过。共享历史夹具 `packages/collab-kernel/test/fixtures/history.ts` 供 `status-pending-06` 复用。

## 2. 准入模型与配置

- 共享夹具 `packages/dsh-collab/test/support/world.ts`：驱动真实 `apply()`，宿主替身对 listSessions/observeSession/inspect/resolveAgent/followup 计数，observe/inspect 一经调用即抛错。第 2、3 组期间临时把新工具名映射到旧 20 工具（第 4 组删除），使失败只来自准入行为。
- RED：`npx vitest run test/session-provider.test.ts`（packages/dsh-collab）
  - admit-04/05/06/07、claim-04、wake-03：`COLLAB_BAD_CONFIG`（旧 Config 不接受 `admission`/`denySessionIds`）；admit-07 另有"非法配置仍注册 20 个工具"。
  - admit-01、claim-01/02/03/05/06：调用者不在空名单 → `COLLAB_CALLER_UNAVAILABLE`/建空间失败；claim-02 旧 safeError 带空 `details`。
  - admit-02、admit-03：首轮即通过（既有参数白名单与无调用者拒绝），属回归防护。
- GREEN：`npx vitest run` → 46 passed；`npm --workspace packages/dsh-collab run typecheck` 通过（需先 `npm --workspace packages/collab-kernel run build` 生成被 git 忽略的 kernel `lib/` 类型声明，基线即如此）。

## 3. 冷恢复与投递

- RED：`npx vitest run test/session-provider.test.ts`
  - wake-02：指针文本不含 `collab_status`。
  - cold-02：首次断言写法错误（在双重转义的 JSON 上查 `"invited":true`）导致假失败，修正断言后通过——这不是行为 RED，如实记录：名单外冷投递已由第 2 组 `admissible` 实现。
  - cold-05、cold-06：首轮即通过。deliver 在开始、恢复后、followup 前已经调用（第 2 组改为）`admissible`，恢复期间归档/关闭均被栅栏挡住；kernel 的 generation 栅栏保证旧实例不写完成记录。属回归防护，无独立 RED。
- GREEN：`npx vitest run` → 53 passed。既有 cold-03/04/07 在新夹具上通过。

## 4. 工具面精简与错误映射

- 先删除第 2 组的旧名映射，测试直接面向新工具面。
- RED：`npx vitest run test/tools.test.ts` → 11 failed：tool-01～04、disclose-01～03 均为 `tool collab_space not registered`（新工具不存在）；契约/映射用例看到 20 个旧工具；safeError 仍透出 `COLLAB_STORE_LOCKED` 与锁身份。
- GREEN：`src/tools.ts` 重写为 12 个工具（封闭 `action`/`view` 逐值校验字段；先执行后映射错误；存储诊断只写宿主 logger）；`collab_status` 暂为占位（第 5 组实现）。`npx vitest run` → 60 passed；typecheck 通过。

## 5. 状态入口

- RED：`npx vitest run test/status.test.ts` → 19 failed，全部因 `collab_status` 占位返回 `COLLAB_NOT_IMPLEMENTED`（输出键为 `error` 而非白名单）。
- GREEN：新增 `src/status.ts`（host-index `readSince(0)` + 内核公开 `reduce`；只遍历 `CollabHost.openSpaces()`，不打开/重开；白名单输出；`SAFE_ID` 过滤 spaceId/itemId；replies 按"自己最后一次发给该发送者的消息 seq"；next 按表；closed 不产生 next）。`SessionAccess.discover()` 改为 `contacts(self)`（种子名单剔除 deny/归档/自身，单次 header 列表核验，列表不可用返回 []），既有 `session-discovery` 用例迁移。`npx vitest run` → 79 passed；typecheck 通过。
- `status-pending-06` 与 `reduce-01` 共用 `packages/collab-kernel/test/fixtures/history.ts`（以 dsh-session channel 重放后写入插件 dataDir）。

## 6. 启动时清理无主锁

- RED：`npx vitest run test/host.test.ts` → lock-02（孤儿锁未被删除）、lock-03/04（宿主日志无诊断行）、lock-05（未探测，锁字节为原值而非替换值）、lock-07（重启后仍锁住不可读）失败；lock-06 首轮通过（既有隔离行为，迁移到新工具面重跑）。
- GREEN：`maintenance.ts` 改为纯判定 `judgeLock`（可解析、正安全整数 pid、探测 ESRCH、删除前字节不变）；`CollabHost.create` 在打开任何空间前扫描全部 `*.lock`，满足则 `breakLock(instanceId)` 并写 `lock cleared` 日志，否则写一行 `lock kept … reason=`；孤儿锁只清理不打开；运行期不处理。删除 `src/cli.mjs`（unlock）、`recoverLock` 导出与 `test/maintenance.test.ts`，`package.json` bin 改为 `dsh-collab-salvage`。`npx vitest run` → 84 passed；typecheck 通过。
- 6.2 暂不勾选：bin 指向的 `lib/salvage.mjs` 由第 7 组提供，打包验证在 7.3。

## 7. 离线 salvage

- RED：`npx vitest run test/salvage.test.ts`，`src/salvage.ts` 为抛 `COLLAB_NOT_IMPLEMENTED` 的占位 → 9 failed（8 个因命令未实现；salvage-01 先在"宿主日志含首个坏行行号"失败）。salvage-06 首轮通过（换新空间本来可用，属回归防护）。build-artifact：在旧打包配置上运行 `node --test test/build-artifact.test.mjs` → 缺 `lib/salvage.mjs`。为取得该 RED 曾临时 `git stash` 三个打包文件并立即 `stash pop` 恢复（stash 列表为空）。
- GREEN：`src/salvage.ts` 按 ①～⑥（`wx` 锁 → 按 FileStore 规则逐行 fatal UTF-8 + `decodeRecord` + seq 连续 → tmp 写入并 fsync → `link` 备份（不覆盖、重名加序号）+ fsync 目录 → `rename` 或无合法记录时删除日志与 tmp + fsync 目录 → 删自己的锁）；tmp 已存在时拒绝并列出三类文件与唯一人工动作；输出保留数、首个坏行、收据丢失与 seq 复用提示。`decodeRecord` 按源码相对路径引用。启动时损坏空间的宿主日志写首个坏行行号。新 `src/cli.mjs` → `lib/salvage.mjs`。`npm --workspace packages/dsh-collab test` → vitest 94 passed，node --test 2 passed（build-artifact 在打包产物上实跑 salvage bin）。
- 额外夹具 `salvage-decode`：非法 UTF-8 在第 1/3/5 行时，整缓冲 FileStore 加载报 CORRUPT，salvage 保留的字节恰为前 N-1 行，`FileStore.open` 可加载 seq 1..N-1。
- salvage-04 的"④⑤之间被终止"以注入的 rename 抛出模拟终止并不释放锁，随后宿主启动按死亡证明（注入 ESRCH）清锁，空间仍为损坏状态、同名创建失败。这是模拟而非真实 SIGKILL。

## 8. 真实宿主层验证

- 依赖：按 `packages/dsh-collab/test/README.zh.md` 在 `spike/collab-components`、`spike/collab-host` 安装（`--ignore-scripts --no-audit --no-fund`，均 exit 0）。所有 runner 使用临时 HOME/DSH_HOME。
- 夹具迁移：controller/consumer/direct-check 探针改用 `collab_space`/`collab_member`/`collab_read`；`collab_sessions` 断言改为 `collab_status.contacts`；工具计数 20→12；`consumer-cold-delivery` 更名 `cold-01`，`component-busy` 更名 `wake-01`；released-host consumer 模式不再手工解锁，改为断言下一次官方启动自行清锁（`lock cleared` 日志行）并重放。
- RED（新测试 + 旧实现）：
  - surface/tool：把新的 controller-seams 与夹具放进 HEAD 源码的临时副本（`git archive HEAD`，用后核验路径删除）构建运行 → 17 中 15 失败：surface-02 `collab tool schema is 5900 chars, budget 4200`；tool-05 无 `collab_status`；tool-06/surface-01 工具名与数量不符；迁移后的既有用例因旧工具名不存在失败。surface-03 在旧代码上也通过（它只验证度量函数会拦住超预算夹具，与实现无关）。
  - lock-01/accept-01：HEAD 构建因旧名在 probe 首步即失败（非目标原因）；因此改用"新代码去掉启动扫描"的变异构建 → budget 子验收 `Official CLI exited before replay-ready`（下次启动无法重放被残锁占住的空间），即目标原因。
- GREEN：`npm --workspace packages/dsh-collab run test:components` → 4/4 + 17/17 passed（surface-02 实测 4002 字符 ≤ 4200）；`run test:host` → normal/budget/kill 三个子验收与 official-direct-composition 全部通过，budget 实测 5004ms，kill 为 SIGKILL，两者下一次官方启动均记录清锁并重放。
- 说明：accept-02 的输出行仅是标签，其实际依据是脚本对官方 bin 版本与 `PROCESS_SHUTDOWN_TIMEOUT_MS = 5e3` 的硬断言（缺失即抛错而非跳过）；accept-03 由 normal 停止后日志字节不变与 controller-seams `consumer-integration` 的 dispose 后工具消失、台账字节不变共同覆盖。

## 9. 文档与全量回归

- 9.1：重写 `packages/dsh-collab/README{,.zh}.md`（准入模式、单 Host 进程/不跨 pid 命名空间前提、deny 与准入需 build+restart、不限邀请与累计唤醒、12 工具与 `collab_status` 入口、三种恢复手段、salvage 后 seq 复用）；同步 `test/README{,.zh}.md` 中 SIGKILL 残锁的描述；`dsh.yaml` 只改 dsh-collab 的 `note`，`enabled` 与临时验收条目未动。`node --test tests/repo-docs-governance.test.mjs` → 30/30 pass。`git diff` 已人工审阅。
- 9.2 实际结果：
  - kernel `test`：38 files / 212 tests passed，Type Errors none；`typecheck`：exit 0。
  - dsh-collab `typecheck`：exit 0（先执行 kernel `build`）；`test`：vitest 6 files / 94 passed + node --test 2/2 pass，0 skip；`test:components`：4/4 + 17/17 pass，0 skip（surface 实测 4002 字符）；`test:host`：normal/budget(5005ms)/kill(SIGKILL) 与 official-direct-composition 全部通过，exit 0。
  - 根 `npm test`：445 tests，442 pass，**1 fail**，2 skipped。skip 原因（测试自带）：`@deepseek-ai/dsh-mcp-client` 只安装在受管 DSH profile/集成探针中。失败为 `tests/repo-facade.test.mjs` "plugin index covers every enabled customization…"：README 插件索引缺 `dsh-collab`、`dsh-collab-lumevm-acceptance`、`ponytail`。前两项来自刻意未提交的验收状态（`enabled: true` 与临时 patch 条目，按约束不得改动）；`ponytail` 在 HEAD 中已启用但未列入 README，与本 change 无关。本 change 对 dsh.yaml 只改 note，不影响该检查。
  - `npm run check:artifacts`：通过。
  - `npx openspec validate dsh-collab-invite-admission --strict`：valid（INFO：dsh-collab 目标 spec 尚不存在，归档前须先归档 `dsh-collab`，与 Workflow follow-up 一致）。
- 9.2 不勾选：根 `npm test` 未全绿（原因如上，不在本 change 可修范围内且受"不改验收状态"约束）。test-plan 全部行均为 🟢。

## 需人裁决

- 无规格与实现矛盾。待人决定：根 `npm test` 的插件索引失败——撤销验收状态（Workflow follow-up）后 dsh-collab 两项会消失；`ponytail` 未列入 README 索引是独立的既有缺口。

## 未验证 / 说明

- 9.3 LumeVM 实机复测未做（范围外）。
- salvage-04 的"④⑤之间被终止"是注入异常模拟，不是真实 SIGKILL；lock-02～07 用注入的 pid 探测替身，真实 ESRCH 路径由 test:host 的 budget/kill 子验收覆盖。
- 体积预算以 controller 组件图的真实 request header 测得（4002）；发行 CLI 下的 header 体积未单独测量。

## 9.2 收尾（Lead 复核）

- Lead 在同一工作树独立重跑：kernel test 212/212、typecheck 0；dsh-collab typecheck 0、test vitest 94/94 + node 2/2；test:components 4/4 + 17/17（真实 header 协作工具 4002 字符 ≤ 4200）；test:host normal/budget/kill/official-direct 全部通过；check:artifacts 0；openspec validate --strict valid。
- 根 `npm test` 首次 445/442/1 fail/2 skip：`repo-facade` 插件索引缺 dsh-collab、dsh-collab-lumevm-acceptance、ponytail、ponytail-skills。用 HEAD 版 dsh.yaml 复跑仍缺 ponytail 两项，证明是既有缺口。按用户"一起"处理：两份根 README 补齐四项（验收 patch 条目标注为临时、验收后移除）。复跑根 `npm test` 445：443 pass、0 fail、2 skip（dsh-mcp-client 仅装于受管 profile 的既有跳过）。

## 9.3 LumeVM 日常 Host 复测（2026-10-20，用户授权 dsh build + dsh restart）

- 部署：dsh build 后再次 build 无变化；部署 lib/index.js 与工作树构建 sha256 一致（63b0e3cb…17b4）。重启由会话内 `perl POSIX::setsid` 脱离进程组后执行 `dsh restart`，rc=0，Host 正常回来，启动清单含 dsh-collab。
- 会话 C = session-4329637f-5bf4-4270-9577-8594d272a6e2，由 Host API `session/create` 新建，未写入任何配置；临时 patch 仅含种子 A/B，admission 为默认 invite。
- A 新建 lumevm-acc-2 并邀请 C（seq1–3）：C 空闲被唤醒，指针含 `collab_status` 入口提示；C 首先调 `collab_status`，invites 恰为 `{spaceId:'lumevm-acc-2', invitedBy:'a'}`，spaces 为空；C 未自动加入。
- 用户授权后 C 以 `collab_member{action:'join'}` 加入（seq4）；status 显示 self=c、待办为空。
- A 创建 item-1（requiredAcks [c]）与 needsReply 消息（seq5–7）；C 被唤醒，status 列出 `acks:[{item-1, revision 1}]`、`replies:[{seq 6, from a}]`；C 读取后 ack（seq8，条目 agreed，A 被唤醒）并回复 needsReply=false（seq10，未再唤醒 A）。A 被唤醒后的 status 中 acks、replies 均为空。
- 未预期但符合规格：C 加入前 A 尝试建条目/发消息分别得到内核 `COLLAB_BAD_ITEM(field=requiredAcks)`、`COLLAB_BAD_RECIPIENT`，台账无新增。
- 全程无配置写入、无第二次重启；profile `cordis.patch.yml` 修改时间仍为 build 时刻；旧台账 lumevm-acc-1 字节不变。

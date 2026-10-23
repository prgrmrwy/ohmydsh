## Test Plan

本账本由脚本从三份 delta 的 `#### Scenario:` 逐条生成，共 71 个场景，无遗漏。已有测试按场景名命中的沿用原测试名（31 条）；其余为新测试（40 条）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 代人受理不唤醒 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-01：代人受理不唤醒` | 🔴 red |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不经受理直接完成 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-02：不经受理直接完成` | 🔴 red |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不能处置非托管成员的 request | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-03：不能处置非托管成员的 request` | 🔴 red |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 作者退役后仍可处置 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-04：作者退役后仍可处置` | 🔴 red |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 未授权空间不可区分 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-05：未授权空间不可区分` | 🔴 red |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 新提交带时间且重放不刷新 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-01：新提交带时间且重放不刷新` | 🔴 red |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 旧日志无时间照常重放 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-02：旧日志无时间照常重放` | 🔴 red |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 篡改时间被识别为损坏 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-03：篡改时间被识别为损坏` | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | `auth-01：动作记为 principal 反查到的成员` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | `auth-02：首次创建与创建重放` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | `auth-03：重复创建同一协作空间` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 已移除的 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | `auth-04：已移除的 internal purpose 被拒绝` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | `auth-05：不存在的协作空间先于成员反查报错` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | `auth-06：公开命令与授权表一致` | 🟢 green（沿用；新增命令与授权表同时改，检查自动覆盖） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | `auth-07：没有按字符串分发的入口` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | `auth-08：非 Leader 邀请被拒` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | `auth-09：他人代为加入被拒` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | `auth-10：provider 代表其他 channel 被拒` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | `auth-12：internal 不能执行成员命令` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | `auth-13：gone 成员不能读写` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 可以读取任意空间 | packages/collab-kernel/test/auth.test.ts | `auth-14：host-index 可以读取任意空间` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 不能执行任何写命令 | packages/collab-kernel/test/auth.test.ts | `auth-15：host-index 不能执行任何写命令` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 在已关闭空间执行成员命令仍为 FORBIDDEN | packages/collab-kernel/test/auth.test.ts | `auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | manager principal 不能执行成员命令或读取 | packages/collab-kernel/test/auth.test.ts | `auth-m-01：manager principal 不能执行成员命令或读取` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未声明托管的 provider 不能作为 manager | packages/collab-kernel/test/auth.test.ts | `auth-m-02：未声明托管的 provider 不能作为 manager` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未知 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | `auth-17：未知 internal purpose 被拒绝` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 承接方正常推进 | packages/collab-kernel/test/requests.test.ts | `requests-01：承接方正常推进且只在终态通知作者` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非承接方推进被拒 | packages/collab-kernel/test/requests.test.ts | `requests-02：非承接方拒绝` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非法跳转被拒 | packages/collab-kernel/test/requests.test.ts | `requests-03：非法跳转且拒绝为终态` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 拒绝也通知作者 | packages/collab-kernel/test/requests.test.ts | `requests-04：拒绝也通知作者` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 自己给自己的 request 不唤醒 | packages/collab-kernel/test/requests.test.ts | `requests-05：自己给自己的 request 不唤醒` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 旧日志中锁定的 request 不能推进 | packages/collab-kernel/test/requests.test.ts | `requests-06：旧日志中锁定的 request 不能推进` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 首次建立并授权 | packages/dsh-collab/test/establish.test.ts | `establish-01：首次建立并授权` | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 中断后重试补齐 | packages/dsh-collab/test/establish.test.ts | `establish-02：中断后重试补齐` | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 托管成员不能建立 | packages/dsh-collab/test/establish.test.ts | `establish-03：托管成员不能建立` | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 非 Leader 不能借此授权 | packages/dsh-collab/test/establish.test.ts | `establish-04：非 Leader 不能借此授权` | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | Leader 授权后接入方接纳成员 | packages/dsh-collab/test/integration.test.ts | `handle-01：Leader 授权后接入方接纳成员` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 未授权空间的响应完全一致 | packages/dsh-collab/test/integration.test.ts | `handle-02：未授权空间的响应完全一致` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 旧句柄的在途托管命令不提交 | packages/dsh-collab/test/integration.test.ts | `handle-03：旧句柄的在途托管命令不提交` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 认领后、提交前地址被撤回 | packages/dsh-collab/test/integration.test.ts | `handle-04：认领后、提交前地址被撤回` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 句柄没有 Leader 能力 | packages/dsh-collab/test/integration.test.ts | `handle-05：句柄没有 Leader 能力` | 🔴 red（断言须更新） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 托管读取只对已授权空间可用 | packages/dsh-collab/test/integration.test.ts | `handle-06：托管读取只对已授权空间可用` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 协作层缺失时登记失败而回复照常 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-01：协作层缺失时登记失败而回复照常` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 管理面不把不可用显示为空 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-02：管理面不把不可用显示为空` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 协作层恢复后自动重新可用 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-03：协作层恢复后自动重新可用` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 存量待办只读保留为旧版 | 旧版待办仍可读到 | packages/dsh-pet/test/collab-todo-legacy.test.ts | `legacy-01：旧版待办仍可读到` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 存量待办只读保留为旧版 | 旧版待办只读 | packages/dsh-pet/test/collab-todo-legacy.test.ts | `legacy-02：旧版待办只读` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 同一流程在新旧存储上输出一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-01：同一流程在新旧存储上输出一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 证据边界值在新旧存储上逐字段一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-02：证据边界值在新旧存储上逐字段一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 并发受理在新旧存储上一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-03：并发受理在新旧存储上一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 失败路径在新旧存储上一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-04：失败路径在新旧存储上一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 同源子会话读到彼此登记的结论 | packages/dsh-pet/test/ledger-read.test.ts | `spec: 同源子会话读到彼此登记的结论 — item registered by a DIFFERENT locus under the same parent is still visible` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 跨主会话不可读 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-01：跨主会话不可读` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 台账不随条目清空而消失 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-02：台账不随条目清空而消失` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 新增条目类型不改既有语义 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-03：新增条目类型不改既有语义` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 换代后仍是同一成员 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-04：换代后仍是同一成员` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 权限切换期间协作层重接不移除成员 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-05：权限切换期间协作层重接不移除成员` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 主会话未加载时不为建空间唤醒它 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-06：主会话未加载时不为建空间唤醒它` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 工具不接受目标参数 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-01：工具不接受目标参数` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 代际更替后待办仍可解析 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-02：代际更替后待办仍可解析` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 入口退役不使待办消失 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-03：入口退役不使待办消失` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 无唯一 current 时拒绝登记 | packages/dsh-pet/test/ledger-track.test.ts | `spec: 无唯一 current 时拒绝登记 — no currentDelivery on the authorized record refuses registration` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 主会话修订条目不改变登记证据 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-04：主会话修订条目不改变登记证据` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 时间在重启后保持不变 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-05：时间在重启后保持不变` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 登记不唤醒主会话 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-06：登记不唤醒主会话` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 登记后队列继续前进 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-01：登记后队列继续前进` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 回复完成不等于事情做完 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-02：回复完成不等于事情做完` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 待办状态变化不外发 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-03：待办状态变化不外发` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 子会话不能推进待办状态 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-04：子会话不能推进待办状态` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 主会话做完后自行标记完成 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-05：主会话做完后自行标记完成` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 不经受理直接了结 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-06：不经受理直接了结` | 🔴 red |

## Coverage Notes

- **沿用行**：MODIFIED 要求中文字未变的场景，沿用已有测试（kernel 的 `auth-*`、`requests-*`，dsh-collab 的 `handle-*`，Pet 的 `spec: …` 两条）。它们在 apply 期间必须保持通过；只能改夹具，不能改断言。唯一标为 🔴 的沿用行是 `handle-05`：规范把句柄方法集合加了三项，断言须随之更新。`auth-06` 从真实类型与授权表比较，新增命令两边同时改即可通过。
- **Pet 现有测试**：`ledger-*.test.ts`、`todo-*.test.ts`、`intent-triage-*.test.ts` 中没有逐字命中场景名的测试，仍是迁移前行为的回归网。apply 期间它们的存储夹具改为 `TodoBackend` 两个实现参数化运行，两边都要通过；断言不改（design D9）。这一步就是"迁移前后功能正常"的第二道证据，与等价测试互补。
- **等价测试夹具**（`todo-migration-equivalence.test.ts`）：同一脚本驱动 `legacy` 与 `collab` 两个 `TodoBackend`；`collab` 用真实 collab-kernel `CollabService` + 真实 dsh-collab `Integrations` 句柄 + 临时目录 file store，两边注入同一假时钟；跟进投递用同一个记录型 port 替身，比较其收到的正文。只归一化 itemId。
- **Pet 侧新测试夹具**：与 collab-kernel 的连接一律经真实 `Integrations` 句柄，不手写 kernel 替身。按 `docs/architecture/dsh-plugin-integration-pitfalls.md` 第 7 节，替身与真实形状不一致已多次掩盖缺陷。
- **真实 Host 验收**（tasks 末组）不进本账本，属于 verify 的人工证据。

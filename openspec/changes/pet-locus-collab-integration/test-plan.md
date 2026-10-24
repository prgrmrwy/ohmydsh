## Test Plan

本账本由脚本从四份 delta 的 `#### Scenario:` 逐条生成，共 106 个场景，无遗漏。已有测试按场景名命中的沿用原测试名（38 条）；其余为新测试（68 条）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 代人受理不唤醒 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-01：代人受理不唤醒` | 🟢 green |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不经受理直接完成 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-02：不经受理直接完成` | 🟢 green |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不能处置非托管成员的 request | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-03：不能处置非托管成员的 request` | 🟢 green |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 作者退役后仍可处置 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-04：作者退役后仍可处置` | 🟢 green |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 未授权空间不可区分 | packages/collab-kernel/test/managed-dispose.test.ts | `dispose-05：未授权空间不可区分` | 🟢 green |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 新提交带时间且重放不刷新 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-01：新提交带时间且重放不刷新` | 🟢 green |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 旧日志无时间照常重放 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-02：旧日志无时间照常重放` | 🟢 green |
| specs/collab-kernel/spec.md → 提交记录携带提交时间 | 篡改时间被识别为损坏 | packages/collab-kernel/test/commit-time.test.ts | `commit-time-03：篡改时间被识别为损坏` | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | `auth-01：动作记为 principal 反查到的成员` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | `auth-02：首次创建与创建重放` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | `auth-03：重复创建同一协作空间` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 已移除的 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | `auth-04：已移除的 internal purpose 被拒绝` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | `auth-05：不存在的协作空间先于成员反查报错` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | `auth-06：公开命令与授权表一致` | 🟢 green（沿用，需随本 change 保持通过） |
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
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 首次建立并授权 | packages/dsh-collab/test/establish.test.ts | `establish-01：首次建立并授权` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 中断后重试补齐 | packages/dsh-collab/test/establish.test.ts | `establish-02：中断后重试补齐` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 托管成员不能建立 | packages/dsh-collab/test/establish.test.ts | `establish-03：托管成员不能建立` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以真实普通会话建立空间并接入自己 | 非 Leader 不能借此授权 | packages/dsh-collab/test/establish.test.ts | `establish-04：非 Leader 不能借此授权` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 托管调用者写入带戳且 cmdId 带命名空间 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-01：托管调用者写入带戳且 cmdId 带命名空间` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 不同戳的同名 cmdId 互不干扰 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-02：不同戳的同名 cmdId 互不干扰` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 兄弟条目对读取不可见 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-03：兄弟条目对读取不可见` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 公开记录引用隐藏记录仍能重放 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-04：公开记录引用隐藏记录仍能重放` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 同一提交中的 dispatch 不泄露兄弟消息 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-05：同一提交中的 dispatch 不泄露兄弟消息` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 状态文本不能传话 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-06：状态文本不能传话` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 隐藏条目的标识不经任何字段泄露 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-07：隐藏条目的标识不经任何字段泄露` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 不能借主会话的公开条目传话 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-08：不能借主会话的公开条目传话` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 可以修订自己的条目 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-09：可以修订自己的条目` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 主会话的条目对子会话只读 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-10：主会话的条目对子会话只读` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 可以引用主会话发给自己的消息 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-11：可以引用主会话发给自己的消息` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 不同 Locus 新开独立话题不继承其它根的额度 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-12：不同 Locus 新开独立话题不继承其它根的额度` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 成员计数不进投影 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-13：成员计数不进投影` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 不能修改、确认或引用兄弟条目 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-14：不能修改、确认或引用兄弟条目` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 无权调用者拿不到旧收据 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-15：无权调用者拿不到旧收据` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 带戳调用者只能发给 main | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-16：带戳调用者只能发给 main` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 戳在途变化时调用失效 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-17：戳在途变化时调用失效` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 超长或非对象的戳视为未解析 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-18：超长或非对象的戳视为未解析` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | 不提供 visible 时不投影也不做写授权 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-19：不提供 visible 时不投影也不做写授权` | 🟢 green |
| specs/dsh-collab/spec.md → 托管调用者的戳、可见投影、写目标授权与 cmdId 命名空间 | visible 可沿 ref 链查前序记录 | packages/dsh-collab/test/stamp-projection.test.ts | `stamp-20：visible 可沿 ref 链查前序记录` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | Leader 授权后接入方接纳成员 | packages/dsh-collab/test/integration.test.ts | `handle-01：Leader 授权后接入方接纳成员` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 未授权空间的响应完全一致 | packages/dsh-collab/test/integration.test.ts | `handle-02：未授权空间的响应完全一致` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 旧句柄的在途托管命令不提交 | packages/dsh-collab/test/integration.test.ts | `handle-03：旧句柄的在途托管命令不提交` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 认领后、提交前地址被撤回 | packages/dsh-collab/test/integration.test.ts | `handle-04：认领后、提交前地址被撤回` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 句柄没有 Leader 能力 | packages/dsh-collab/test/integration.test.ts | `handle-05：句柄没有 Leader 能力` | 🟢 green（断言已更新为 10 个方法） |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 托管读取只对已授权空间可用 | packages/dsh-collab/test/integration.test.ts | `handle-06：托管读取只对已授权空间可用` | 🟢 green |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 受管子会话以托管成员身份写入 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-01：受管子会话以托管成员身份写入` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 解除绑定后立即失去身份 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-02：解除绑定后立即失去身份` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 在途调用在失效后不能完成 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-03：在途调用在失效后不能完成（参数化）` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 状态入口在返回前重验 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-04：状态入口在返回前重验` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 普通会话不能被接入方冒认 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-05：普通会话不能被接入方冒认` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 排除名单与归档对托管调用者同样生效 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-06：排除名单与归档对托管调用者同样生效` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 未被认领的子会话仍被拒绝 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-07：未被认领的子会话仍被拒绝` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 托管调用者的状态入口 | packages/dsh-collab/test/managed-caller.test.ts | `mcaller-08：托管调用者的状态入口` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 协作层缺失时登记失败而回复照常 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-01：协作层缺失时登记失败而回复照常` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 管理面不把不可用显示为空 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-02：管理面不把不可用显示为空` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层不可用时台账与待办 fail closed | 协作层恢复后自动重新可用 | packages/dsh-pet/test/collab-todo-availability.test.ts | `availability-03：协作层恢复后自动重新可用` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 存量待办只读保留为旧版 | 旧版待办只在管理面 | packages/dsh-pet/test/collab-todo-legacy.test.ts | `legacy-01：旧版待办只在管理面` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 存量待办只读保留为旧版 | 旧版待办只读 | packages/dsh-pet/test/collab-todo-legacy.test.ts | `legacy-02：旧版待办只读` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 协作层发给代理的记录按 locus 路由 | 回应消息沿 ref 路由到最近的戳 | packages/dsh-pet/test/collab-proxy-routing.test.ts | `routing-01：回应消息沿 ref 路由到最近的戳` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 协作层发给代理的记录按 locus 路由 | 正文点名 | packages/dsh-pet/test/collab-proxy-routing.test.ts | `routing-02：正文点名` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 协作层发给代理的记录按 locus 路由 | 无法路由不猜 | packages/dsh-pet/test/collab-proxy-routing.test.ts | `routing-03：无法路由不猜` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 协作层发给代理的记录按 locus 路由 | 零 active child 时终态仍登记 | packages/dsh-pet/test/collab-proxy-routing.test.ts | `routing-04：零 active child 时终态仍登记` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 同一流程在新旧存储上输出一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-01：同一流程在新旧存储上输出一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 证据边界值在新旧存储上逐字段一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-02：证据边界值在新旧存储上逐字段一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 并发受理在新旧存储上一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-03：并发受理在新旧存储上一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 迁移前后待办行为等价 | 失败路径在新旧存储上一致 | packages/dsh-pet/test/todo-migration-equivalence.test.ts | `equivalence-04：失败路径在新旧存储上一致` | 🔴 red |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 兄弟子会话读不到彼此登记的结论 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-01：兄弟子会话读不到彼此登记的结论` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 跨主会话不可读 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-02：跨主会话不可读` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 台账不随条目清空而消失 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-03：台账不随条目清空而消失` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 新增条目类型不改既有语义 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-04：新增条目类型不改既有语义` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 换代后登记照旧归入同一代理 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-05：换代后登记照旧归入同一代理` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 共享事实台账按主会话归属并对同源只读开放 | 主会话未加载时不为建空间唤醒它 | packages/dsh-pet/test/collab-ledger-scope.test.ts | `scope-06：主会话未加载时不为建空间唤醒它` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 工具不接受目标参数 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-01：工具不接受目标参数` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 代际更替后待办仍可解析 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-02：代际更替后待办仍可解析` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 入口退役不使待办消失 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-03：入口退役不使待办消失` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 无唯一 current 时拒绝登记 | packages/dsh-pet/test/ledger-track.test.ts | `spec: 无唯一 current 时拒绝登记 — no currentDelivery on the authorized record refuses registration` | 🟢 green（沿用，需随本 change 保持通过） |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 登记不唤醒主会话 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-04：登记不唤醒主会话` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 主会话修订条目不改变登记证据 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-05：主会话修订条目不改变登记证据` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记固定来源与回复去向且关联标识而非实例 | 时间在重启后保持不变 | packages/dsh-pet/test/collab-todo-track.test.ts | `track-06：时间在重启后保持不变` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 登记后队列继续前进 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-01：登记后队列继续前进` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 回复完成不等于事情做完 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-02：回复完成不等于事情做完` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 待办状态变化不外发 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-03：待办状态变化不外发` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 子会话不能推进待办状态 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-04：子会话不能推进待办状态` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 主会话做完后自行标记完成 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-05：主会话做完后自行标记完成` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 不经受理直接了结 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `lifecycle-06：不经受理直接了结` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 关联具备双向发现且不过度披露 | 双向核对 | packages/dsh-pet/test/collab-child-toolface.test.ts | `toolface-01：双向核对` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 关联具备双向发现且不过度披露 | 子会话反查 | packages/dsh-pet/test/collab-child-toolface.test.ts | `toolface-02：子会话反查` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 关联具备双向发现且不过度披露 | 子会话的协作工具面 | packages/dsh-pet/test/collab-child-toolface.test.ts | `toolface-03：子会话的协作工具面` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 关联具备双向发现且不过度披露 | 子会话不能向兄弟发消息 | packages/dsh-pet/test/collab-child-toolface.test.ts | `toolface-04：子会话不能向兄弟发消息` | 🟢 green |

## Coverage Notes

- **现行场景无同名测试的两条**（`双向核对`、`子会话反查`）：它们属于被 MODIFIED 的要求，现有测试没有按场景名命名，本次补两条断言现行行为的测试，不改行为。
- **沿用行**：MODIFIED 要求中文字未变的场景沿用已有测试（kernel 的 `auth-*`、`requests-*`，dsh-collab 的 `handle-*`、`caller-*`，Pet 的 `spec: …`）。apply 期间它们必须保持通过；只能改夹具，不能改断言。唯一需要改断言的沿用行是 `handle-05`（句柄方法集合新增三项）。
- **MODIFIED 要求"工具调用者可解析为托管成员"** 只在要求文字里加了一句 `resolveCaller` 可返回 `{address, stamp}`，其原有场景不变，全部沿用 `managed-caller.test.ts`。
- **Pet 参数化落地（task-5）**：`ledger-store.test.ts` 的 5 条接口契约用例与 `ledger-delivery-decoupling.test.ts` 末条 e2e 经 `test/todo-backends.ts` 的 `todoBackendCases` 参数化（断言只加 await）；legacy 专属用例（表行、`listByLocusId`、重启、畸形行）保持 legacy-only。手写替身的 `todo-dispatch`、`ledger-track`、`todo-action-route`、`ledger-tool-scope` 不经存储，不参数化；`ledger-read` 只测将退役工具，不参数化。新旧存储等价由第 8 组 equivalence 端到端覆盖。
- **Pet 现有测试**：`ledger-*.test.ts`、`todo-*.test.ts`、`intent-triage-*.test.ts` 中没有逐字命中场景名的测试，仍是迁移前行为的回归网。apply 期间它们的存储夹具改为 `TodoBackend` 两个实现参数化运行，两边都要通过；断言不改（design D9）。这是"迁移前后功能正常"的第二道证据，与等价测试互补。
- **等价测试夹具**（`todo-migration-equivalence.test.ts`）：同一脚本驱动 `legacy` 与 `collab` 两个 `TodoBackend`；`collab` 用真实 collab-kernel `CollabService` + 真实 dsh-collab `Integrations` 句柄 + 临时目录 file store，两边注入同一假时钟；跟进投递用同一个记录型 port 替身。只归一化 itemId。三条 `pet_locus_ledger_read` 指引句是唯一允许的文本差异。
- **投影与授权测试**（`stamp-projection.test.ts`）：用真实 `Integrations` + 内存 kernel，接入方 adapter 是测试替身（只提供 `resolveCaller`/`visible`/`recipients`），对 `overview`/`status` 的断言用完整 JSON 序列化比对。
- **Pet 侧新测试夹具**：与 collab-kernel 的连接一律经真实 `Integrations` 句柄，不手写 kernel 替身（`docs/architecture/dsh-plugin-integration-pitfalls.md` 第 7 节）。
- **接缝门 3.1**：`establish-00` 位于 `packages/dsh-collab/test/controller-seams.test.mjs`（`npm run test:components -- --controller`），用真实 sessionController 创建的会话、模型空闲无轮次时作 exec，经句柄提交与读取均成功、未触发模型请求。
- **额外测试**：`stamp-h1`（句柄写入合并戳且戳优先、带附加事实的条目对子会话只读）；`handle-07`（disposeRequest 幂等、actor、未授权与 dispose 后错误）不对应独立场景，按 anvil 允许保留。
- **真实 Host 验收**（tasks 末组）不进本账本，属于 verify 的人工证据。

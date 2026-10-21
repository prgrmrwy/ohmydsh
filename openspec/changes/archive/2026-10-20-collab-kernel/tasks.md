PRECHECK：第 8 轮评审 `APPROVE`，无要求修改。实现、测试与独立代码复核已完成；验证记录保留TDD流程偏差与全仓既有skip，不据此虚称严格门禁通过。

本内核包独立开发、构建和测试，不依赖 `sync-build-inputs-dirs` 先完成；目录输入能力只阻塞后续 `dsh-collab` 集成/部署，内核自身不调用 sync。`dsh-collab` 的真实 close/强退、冷恢复、确认入口是其集成前置验收，不声称本 change 已完成这些实验。

交付 / 证明映射：0 包与仓库治理 → package build/typecheck、根治理测试；1–19 全部 19 条 requirement → test-plan 的 108 行；20 正文与整体回归 → package test/build/typecheck、根 test/check:artifacts、严格 OpenSpec 校验。

## 0. 包骨架

- [x] 0.1 新建 `packages/collab-kernel`：`package.json`（零运行时依赖；不声明 `@deepseek-ai/*` 和 `dsh.bundle`；`ohmydsh.docTier: "C"`；devDependencies 为 typescript、@types/node、vitest 和 mdast-util-from-markdown，加入后在仓库根执行 `npm install`，**需要先通过 `ws promote` 切换为 mutable**）、`tsconfig.json`（沿用 dsh-memex 的 strict 配置）、`vitest.config.ts`（开启 typecheck）、`README.md` 和 `README.zh.md`（C 级：`<!-- problem -->` 段落和 `<!-- section: removal -->` 章节，写明这是由 dsh-collab 内联的库）、`LICENSE`；把 `lib/` 加入忽略；在 `tests/repo-docs-governance.test.mjs` 的等级表中加入 `'collab-kernel': 'C'`，并更新 `packages/README*.md` 的 C 级列表
- [x] 0.2 建立 `src/` 目录结构和 `test/support/` 共享夹具
- [x] 0.3 运行 `npm test -- --passWithNoTests`（仅包骨架尚无测试时允许空套件）、`npm run typecheck`，以及仓库根目录的 `npm run check:artifacts`，确认工具链可用、`lib/` 不会被纳入版本控制

## 1. 协作内核不依赖任何宿主

- [x] 1.1 编写失败测试：boundary-01, boundary-02（`packages/collab-kernel/test/boundary.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 1.2 实现：仅在 `test/support/` 内的 `scanImports(dir)`、真实 `src/` 与负夹具检查，不放进运行时或公开 exports（design D1），使 1.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 1.3 重构；全量测试保持绿色

## 2. 封闭的命令集合与授权

- [x] 2.1 编写失败测试：auth-01, auth-02, auth-03, auth-04, auth-05, auth-06, auth-07, auth-08, auth-09, auth-10, auth-11, auth-12, auth-13（`packages/collab-kernel/test/auth.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 2.2 实现：具名命令方法、principal brand、三分支写流水线与读取流水线、授权表；测试从真实公开类型提取可调用成员，并用漏登记 `unsafeWrite` 的夹具验证覆盖检查，不维护或导出 `COMMANDS` 清单（design D3、D6），使 2.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 2.3 重构；全量测试保持绿色

## 3. 成员模型与地址唯一

- [x] 3.1 编写失败测试：members-01, members-02, members-03, members-04, members-05, members-06, members-07（`packages/collab-kernel/test/members.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 3.2 实现：单绑定成员、`claim(address, kind)`、名字与地址唯一不可复用（design D7），使 3.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 3.3 重构；全量测试保持绿色

## 4. 协作空间的创建、Leader 转交与关闭

- [x] 4.1 编写失败测试：lifecycle-01, lifecycle-02, lifecycle-03, lifecycle-04, lifecycle-05, lifecycle-06（`packages/collab-kernel/test/lifecycle.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 4.2 实现：createSpace 分支、一步 `transferLeader`、自动接手与关闭、关闭后只读（design D8），使 4.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 4.3 重构；全量测试保持绿色

## 5. 条目状态转换表

- [x] 5.1 编写失败测试：items-01, items-02, items-03, items-04, items-05, items-06, items-07（`packages/collab-kernel/test/items.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 5.2 实现：显式状态转换表、CAS、ack 绑定 revision、字段校验（design D2），使 5.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 5.3 重构；全量测试保持绿色

## 6. 消息与状态文本

- [x] 6.1 编写失败测试：messages-01, messages-02, messages-03, messages-04, messages-05（`packages/collab-kernel/test/messages.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 6.2 实现：`sendMessage` / `setStatus` 输入校验，使 6.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 6.3 重构；全量测试保持绿色

## 7. request 条目的承接流程

- [x] 7.1 编写失败测试：requests-01, requests-02, requests-03（`packages/collab-kernel/test/requests.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 7.2 实现：`progress` 状态机（open → accepted → done | rejected），使 7.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 7.3 重构；全量测试保持绿色

## 8. agent 往返超限自动升级为待人决定

- [x] 8.1 编写失败测试：escalation-01, escalation-02, escalation-03（`packages/collab-kernel/test/escalation.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 8.2 实现：`agentEditCount` 与 `ESCALATE_AFTER`，使 8.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 8.3 重构；全量测试保持绿色

## 9. 人类决定只能由带证据的确认产生

- [x] 9.1 编写失败测试：decisions-01, decisions-02, decisions-03, decisions-04, decisions-05, decisions-06, decisions-07, decisions-08, decisions-09, decisions-10, decisions-11（`packages/collab-kernel/test/decisions.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 9.2 实现：单一 open 请求、确认前置条件、`(providerId, actionId)` 幂等、4 项业务校验（design D9），使 9.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 9.3 重构；全量测试保持绿色

## 10. 命令按 cmdId 幂等

- [x] 10.1 编写失败测试：idempotency-01, idempotency-02, idempotency-03, idempotency-04, idempotency-05, idempotency-06, idempotency-07（`packages/collab-kernel/test/idempotency.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 10.2 实现：带类型标签的 scope 与收据（design D3），使 10.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 10.3 重构；全量测试保持绿色

## 11. 事件日志是唯一真源，读取是纯操作

- [x] 11.1 编写失败测试：log-01, log-02（`packages/collab-kernel/test/log.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 11.2 实现：`reduce` 重放与纯读 `readSince`，使 11.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 11.3 重构；全量测试保持绿色

## 12. 存储按命令原子提交，并由排他锁保证单写入方

- [x] 12.1 编写失败测试：store-01, store-02, store-03, store-04, store-05, store-06, store-07, store-08, store-09, store-10, store-11, store-12（`packages/collab-kernel/test/store.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 12.2 实现：`FileStore`：一行一提交、写满循环、fsync、残片截断、损坏拒绝、failed、close 排空、排他锁、`breakLock`（design D4、D5），使 12.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 12.3 重构；全量测试保持绿色

## 13. 状态只经命令产生

- [x] 13.1 编写失败测试：surface-01, surface-02（`packages/collab-kernel/test/surface.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 13.2 实现：`serviceId` 记录、`COLLAB_SPACE_NOT_FOUND`、公开类型不含事件写入，使 13.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 13.3 重构；全量测试保持绿色

## 14. 唤醒只投结构化指针，按事件类型决定接收方

- [x] 14.1 编写失败测试：wake-01, wake-02, wake-03, wake-04（`packages/collab-kernel/test/wake.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 14.2 实现：唤醒接收方表、邀请例外、白名单指针（design D10），使 14.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 14.3 重构；全量测试保持绿色

## 15. 投递意图在事务内记账

- [x] 15.1 编写失败测试：dispatch-01, dispatch-02, dispatch-03, dispatch-04, dispatch-05, dispatch-06, dispatch-07, dispatch-08, dispatch-09, dispatch-10，以及 R8-S1 额外回归 dispatch-close-late（`packages/collab-kernel/test/dispatch.test.ts` 与 `dispatch-persistence.test.ts`（08/10）；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 15.2 实现：同一提交记账、事务外 SPI 调用（不设超时）、内部写入 `dispatch/completed`（design D10），使 15.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 15.3 重构；全量测试保持绿色

## 16. 选择绑定与在线状态

- [x] 16.1 编写失败测试：binding-01, binding-02, binding-03（`packages/collab-kernel/test/presence.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 16.2 实现：事务前采样 presence、能力判断、`awaitingChannel`，使 16.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 16.3 重构；全量测试保持绿色

## 17. 按成员计数的熔断

- [x] 17.1 编写失败测试：breaker-01, breaker-02, breaker-03, breaker-04, breaker-05（`packages/collab-kernel/test/breaker.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 17.2 实现：只计 wake 的计数、`BREAKER_LIMIT`、决定时 reset（design D10），使 17.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 17.3 重构；全量测试保持绿色

## 18. 状态投影只呈现当前值，且以纯文本安全输出

- [x] 18.1 编写失败测试：projection-01, projection-02, projection-03, projection-04（`packages/collab-kernel/test/projection.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 18.2 实现：`project(state, presence)` 单次转义（design D12），使 18.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 18.3 重构；全量测试保持绿色

## 19. 协作约定随协作空间提供

- [x] 19.1 编写失败测试：convention-01, convention-02（`packages/collab-kernel/test/convention.test.ts`；逐个确认它们失败是因为行为缺失，而不是语法或夹具问题）
- [x] 19.2 实现：`convention/v1.md`、sha256、`readConvention`（design D13），使 19.1 全部通过，并在 test-plan.md 中把对应行翻为 🟢 green
- [x] 19.3 重构；全量测试保持绿色

## 20. 收尾验证

- [x] 20.1 将本 change 的 `convention-v1-draft.md` 按已批准 spec 核对后整理为 `src/convention/v1.md` 正文；正文草案已自包含，不依赖仓库外的旧 README/LOOP 文件；消息标题只是正文惯例，不能新增消息类型或授权
- [x] 20.2 在 `packages/collab-kernel` 下运行 `npm test`、`npm run typecheck`、`npm run build`，全部通过；确认 test-plan.md 的 108 行全部为 🟢
- [x] 20.3 在仓库根目录运行 `npm test` 和 `npm run check:artifacts`，无回归
- [x] 20.4 运行 `openspec validate collab-kernel --strict`，通过后进入 verify

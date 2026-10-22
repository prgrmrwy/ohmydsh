## 0. 准备

- [ ] 0.1 删除 `packages/collab-kernel/test/breaker.test.ts` 并确认其场景已由 chain-07/09/10 覆盖（grep 场景名无遗漏）
- [ ] 0.2 运行 kernel 与 dsh-collab 现有测试，记录基线全绿（含 test:components）

## 1. 协作约定 v3 与版本表

- [ ] 1.1 Write failing test: `convention-01：service creation records the bundled convention and authorised reads return exact bytes`（packages/collab-kernel/test/convention-integration.test.ts）— 断言因预期原因失败
- [ ] 1.2 Implement: 使「总览带约定版本」通过 1.1
- [ ] 1.3 Refactor; full suite stays green
- [ ] 1.4 Write failing test: `convention-04：v1 and v2 spaces keep reading their recorded version`（packages/collab-kernel/test/convention-integration.test.ts）— 断言因预期原因失败
- [ ] 1.5 Implement: 使「旧空间仍按原版本读取」通过 1.4
- [ ] 1.6 Refactor; full suite stays green
- [ ] 1.7 Write failing test: `convention-03：已发布的 v1 与 v2 文本不可变`（packages/collab-kernel/test/convention.test.ts）— 断言因预期原因失败
- [ ] 1.8 Implement: 使「已发布文本不可变」通过 1.7
- [ ] 1.9 Refactor; full suite stays green
- [ ] 1.10 Write failing test: `convention-05：v3 包含链长规则`（packages/collab-kernel/test/convention.test.ts）— 断言因预期原因失败
- [ ] 1.11 Implement: 使「v3 包含链长规则」通过 1.10
- [ ] 1.12 Refactor; full suite stays green

## 2. ref 校验与链长推导（reduce/itemSeq/chain）

- [ ] 2.1 Write failing test: `ref-01：引用先前消息`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.2 Implement: 使「引用先前消息」通过 2.1
- [ ] 2.3 Refactor; full suite stays green
- [ ] 2.4 Write failing test: `ref-02：引用条目的创建 seq`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.5 Implement: 使「引用条目的创建 seq」通过 2.4
- [ ] 2.6 Refactor; full suite stays green
- [ ] 2.7 Write failing test: `ref-03：不写 ref 时事件形状不变`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.8 Implement: 使「不写 ref 时事件形状不变」通过 2.7
- [ ] 2.9 Refactor; full suite stays green
- [ ] 2.10 Write failing test: `ref-04：特殊 itemId 的创建 seq 可查`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.11 Implement: 使「特殊 itemId 的创建 seq 可查」通过 2.10
- [ ] 2.12 Refactor; full suite stays green
- [ ] 2.13 Write failing test: `ref-05：消息引用不存在或不可引用的 seq`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.14 Implement: 使「消息引用不存在或不可引用的 seq」通过 2.13
- [ ] 2.15 Refactor; full suite stays green
- [ ] 2.16 Write failing test: `ref-06：条目引用非法 seq`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.17 Implement: 使「条目引用非法 seq」通过 2.16
- [ ] 2.18 Refactor; full suite stays green
- [ ] 2.19 Write failing test: `ref-07：多重错误时先报既有校验`（packages/collab-kernel/test/refs.test.ts）— 断言因预期原因失败
- [ ] 2.20 Implement: 使「多重错误时先报既有校验」通过 2.19
- [ ] 2.21 Refactor; full suite stays green

## 3. 链长上限与豁免（chainCheck 复用 reduce）

- [ ] 3.1 Write failing test: `chain-01：同一链第 21 环被拒绝`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.2 Implement: 使「同一链第 21 环被拒绝」通过 3.1
- [ ] 3.3 Refactor; full suite stays green
- [ ] 3.4 Write failing test: `chain-02：不写 ref 的新消息从 1 开始`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.5 Implement: 使「不写 ref 的新消息从 1 开始」通过 3.4
- [ ] 3.6 Refactor; full suite stays green
- [ ] 3.7 Write failing test: `chain-03：不叫醒人的命令不受限`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.8 Implement: 使「不叫醒人的命令不受限」通过 3.7
- [ ] 3.9 Refactor; full suite stays green
- [ ] 3.10 Write failing test: `chain-04：条目往返计入链长`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.11 Implement: 使「条目往返计入链长」通过 3.10
- [ ] 3.12 Refactor; full suite stays green
- [ ] 3.13 Write failing test: `chain-05：request 进度计入链长`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.14 Implement: 使「request 进度计入链长」通过 3.13
- [ ] 3.15 Refactor; full suite stays green
- [ ] 3.16 Write failing test: `chain-06：request 进度不受链长限制`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.17 Implement: 使「request 进度不受链长限制」通过 3.16
- [ ] 3.18 Refactor; full suite stays green
- [ ] 3.19 Write failing test: `chain-07：人类决定不受链长限制`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.20 Implement: 使「人类决定不受链长限制」通过 3.19
- [ ] 3.21 Refactor; full suite stays green
- [ ] 3.22 Write failing test: `chain-08：邀请不归属任何链`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.23 Implement: 使「邀请不归属任何链」通过 3.22
- [ ] 3.24 Refactor; full suite stays green
- [ ] 3.25 Write failing test: `chain-09：旧的成员级熔断不再阻断`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.26 Implement: 使「旧的成员级熔断不再阻断」通过 3.25
- [ ] 3.27 Refactor; full suite stays green
- [ ] 3.28 Write failing test: `chain-10：旧日志中的 breaker/reset 照常重放`（packages/collab-kernel/test/chain.test.ts）— 断言因预期原因失败
- [ ] 3.29 Implement: 使「旧日志中的 breaker/reset 照常重放」通过 3.28
- [ ] 3.30 Refactor; full suite stays green

## 4. 移除成员熔断、resetBreaker 与 breaker-reset purpose

- [ ] 4.1 Write failing test: `auth-04：已移除的 internal purpose 被拒绝`（packages/collab-kernel/test/auth.test.ts）— 断言因预期原因失败
- [ ] 4.2 Implement: 使「已移除的 internal purpose 被拒绝」通过 4.1
- [ ] 4.3 Refactor; full suite stays green
- [ ] 4.4 Write failing test: `auth-06：公开命令与授权表一致`（packages/collab-kernel/test/auth.test.ts）— 断言因预期原因失败
- [ ] 4.5 Implement: 使「公开命令与授权表一致」通过 4.4
- [ ] 4.6 Refactor; full suite stays green
- [ ] 4.7 Write failing test: `auth-12：internal 不能执行成员命令`（packages/collab-kernel/test/auth.test.ts）— 断言因预期原因失败
- [ ] 4.8 Implement: 使「internal 不能执行成员命令」通过 4.7
- [ ] 4.9 Refactor; full suite stays green
- [ ] 4.10 Write failing test: `auth-15：host-index 不能执行任何写命令`（packages/collab-kernel/test/auth.test.ts）— 断言因预期原因失败
- [ ] 4.11 Implement: 使「host-index 不能执行任何写命令」通过 4.10
- [ ] 4.12 Refactor; full suite stays green
- [ ] 4.13 Write failing test: `auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN`（packages/collab-kernel/test/auth.test.ts）— 断言因预期原因失败
- [ ] 4.14 Implement: 使「internal 在已关闭空间执行成员命令仍为 FORBIDDEN」通过 4.13
- [ ] 4.15 Refactor; full suite stays green
- [ ] 4.16 Write failing test: `lifecycle-05：无人接手关闭`（packages/collab-kernel/test/lifecycle.test.ts）— 断言因预期原因失败
- [ ] 4.17 Implement: 使「无人可接手时关闭」通过 4.16
- [ ] 4.18 Refactor; full suite stays green
- [ ] 4.19 Write failing test: `lifecycle-06：主动关闭后只读`（packages/collab-kernel/test/lifecycle.test.ts）— 断言因预期原因失败
- [ ] 4.20 Implement: 使「主动关闭后仍可读取」通过 4.19
- [ ] 4.21 Refactor; full suite stays green
- [ ] 4.22 Write failing test: `projection-05：投影不再出现 paused`（packages/collab-kernel/test/projection.test.ts）— 断言因预期原因失败
- [ ] 4.23 Implement: 使「投影不再出现 paused」通过 4.22
- [ ] 4.24 Refactor; full suite stays green

## 5. 唤醒表：Leader 转交不唤醒、指针 thread

- [ ] 5.1 Write failing test: `wake-01：需回复消息叫醒收件人`（packages/collab-kernel/test/wake.test.ts）— 断言因预期原因失败
- [ ] 5.2 Implement: 使「需回复消息叫醒收件人」通过 5.1
- [ ] 5.3 Refactor; full suite stays green
- [ ] 5.4 Write failing test: `wake-04：邀请叫醒被邀请者但不授予读取权限`（packages/collab-kernel/test/wake.test.ts）— 断言因预期原因失败
- [ ] 5.5 Implement: 使「邀请叫醒被邀请者」通过 5.4
- [ ] 5.6 Refactor; full suite stays green
- [ ] 5.7 Write failing test: `wake-05：Leader 转交不叫醒新 Leader`（packages/collab-kernel/test/wake.test.ts）— 断言因预期原因失败
- [ ] 5.8 Implement: 使「Leader 转交不叫醒新 Leader」通过 5.7
- [ ] 5.9 Refactor; full suite stays green

## 6. 幂等与旧收据

- [ ] 6.1 Write failing test: `idempotency-07：成员与旧 internal 收据互不冲突`（packages/collab-kernel/test/idempotency.test.ts）— 断言因预期原因失败
- [ ] 6.2 Implement: 使「成员与旧 internal 收据互不冲突」通过 6.1
- [ ] 6.3 Refactor; full suite stays green
- [ ] 6.4 Write failing test: `idempotency-08：ref 是幂等载荷的一部分`（packages/collab-kernel/test/idempotency.test.ts）— 断言因预期原因失败
- [ ] 6.5 Implement: 使「ref 是幂等载荷的一部分」通过 6.4
- [ ] 6.6 Refactor; full suite stays green

## 7. dsh-collab 工具 ref 参数

- [ ] 7.1 Write failing test: `tool-07：ref 原样传给内核`（packages/dsh-collab/test/tools.test.ts）— 断言因预期原因失败
- [ ] 7.2 Implement: 使「ref 原样传给内核」通过 7.1
- [ ] 7.3 Refactor; full suite stays green
- [ ] 7.4 Write failing test: `tool-08：不填 ref 时输入不含该键`（packages/dsh-collab/test/tools.test.ts）— 断言因预期原因失败
- [ ] 7.5 Implement: 使「不填 ref 时输入不含该键」通过 7.4
- [ ] 7.6 Refactor; full suite stays green
- [ ] 7.7 Write failing test: `tool-09：超出链长原样返回`（packages/dsh-collab/test/tools.test.ts）— 断言因预期原因失败
- [ ] 7.8 Implement: 使「超出链长原样返回」通过 7.7
- [ ] 7.9 Refactor; full suite stays green

## 8. dsh-collab 指针转发 thread

- [ ] 8.1 Write failing test: `wake-05：话题唤醒携带链起点`（packages/dsh-collab/test/session-provider.test.ts）— 断言因预期原因失败
- [ ] 8.2 Implement: 使「话题唤醒携带链起点」通过 8.1
- [ ] 8.3 Refactor; full suite stays green
- [ ] 8.4 Write failing test: `wake-06：非整数 thread 不被转发`（packages/dsh-collab/test/session-provider.test.ts）— 断言因预期原因失败
- [ ] 8.5 Implement: 使「非整数 thread 不被转发」通过 8.4
- [ ] 8.6 Refactor; full suite stays green

## 9. dsh-collab 状态入口 request seq

- [ ] 9.1 Write failing test: `status-shape-03：request 待办带条目 seq`（packages/dsh-collab/test/status.test.ts）— 断言因预期原因失败
- [ ] 9.2 Implement: 使「request 待办带条目 seq」通过 9.1
- [ ] 9.3 Refactor; full suite stays green
- [ ] 9.4 Write failing test: `status-shape-04：request seq 只取自重放推导`（packages/dsh-collab/test/status.test.ts）— 断言因预期原因失败
- [ ] 9.5 Implement: 使「request seq 只取自重放推导」通过 9.4
- [ ] 9.6 Refactor; full suite stays green

## 10. dsh-collab 工具体积预算

- [ ] 10.1 Write failing test: `surface-04：新增 ref 参数后仍在预算内`（packages/dsh-collab/test/controller-seams.test.mjs）— 断言因预期原因失败
- [ ] 10.2 Implement: 使「新增 ref 参数后仍在预算内」通过 10.1
- [ ] 10.3 Refactor; full suite stays green

## 11. 打包、文档与配置

- [ ] 11.1 Write failing test: build-artifact/sync-artifact 断言 `lib/v3.md` 存在且与源字节一致
- [ ] 11.2 Implement: `tsdown.config.ts` 复制 v1/v2/v3（替换写死的 `['v1.md','v2.md']`）
- [ ] 11.3 Refactor; full suite stays green
- [ ] 11.4 Run 更新 dsh-collab README（中英）与 `dsh.yaml` note：去掉"每成员6次熔断/约定v2"，写链长 20、COLLAB_THREAD_LIMIT 与 ref；`npm test` 中 repo 文档治理测试通过
- [ ] 11.5 Run 记录归档时同步更新 collab-kernel spec Purpose 行（"投递与熔断"→"投递与链长上限"）的待办

## 12. 验证

- [ ] 12.1 Run `npm --workspace packages/collab-kernel test` 与 typecheck；confirm passes
- [ ] 12.2 Run `npm --workspace packages/dsh-collab test`、typecheck、`test:components`；confirm passes（含真实 header 体积 ≤ 4200）
- [ ] 12.3 Run 根 `npm test`、`npm run check:artifacts`；与基线对比无新增失败
- [ ] 12.4 Run `openspec validate collab-ref-threads --strict`；test-plan 所有行为 🟢
- [ ] 12.5 Run 真实 Host 验收（`dsh build` + 重启后）：旧暂停成员恢复；同链第 21 环收到 COLLAB_THREAD_LIMIT；不写 ref 重新从 1 计；Leader 转交不唤醒

## 0. 基线

- [ ] 0.1 在任何修改之前运行 kernel 与 dsh-collab 全部测试（含 `test:components`）、typecheck 与根 `npm test`，记录基线（含既有失败清单）
- [ ] 0.2 确认 test-plan 中标为 🟢 的保留行为测试在基线上为绿

## 1. 协作约定 v3（独立批次）

- [ ] 1.1 Write failing tests: `convention-01：service creation records the bundled convention and authorised reads return exact bytes`; `convention-05：v3 包含链长规则` —— 断言 v3 缺失或内容不符导致失败
- [ ] 1.2 Implement: 新增 `v3.md`（v2 修订副本：删去成员熔断段落，新增"链与往返上限"），版本表默认 v3；v1/v2 字节不动
- [ ] 1.3 Refactor; full suite stays green（保留行为的 v1/v2 sha 与读取测试始终为绿）

## 2. ref 校验与链长推导（不改上限与熔断）

- [ ] 2.1 Write failing tests: `ref-01：引用先前消息`; `ref-02：引用条目的创建 seq`; `ref-04：特殊 itemId 的创建 seq 可查`; `ref-05：消息引用不存在或不可引用的 seq`; `ref-06：条目引用非法 seq`; `ref-08：悬空引用的日志加载失败`; `idempotency-08：ref 是幂等载荷的一部分` —— 断言因缺少 ref 支持而失败
- [ ] 2.2 Implement: `sendMessage`/`createItem` 接受 `ref`；`reduce` 维护 `chain`/`itemSeq`（自有属性写入；以事件前状态判定是否叫醒）；总览投影 `chainLength`/`itemSeq`；悬空 ref 加载失败
- [ ] 2.3 Refactor; full suite stays green

## 3. 用链长上限替换成员熔断（不可拆分的批次）

- [ ] 3.1 Write failing tests (new behavior): `chain-01：同一链第 21 环被拒绝`; `chain-02：不写 ref 的新消息从 1 开始`; `chain-03：不叫醒人的命令不受限`; `chain-04：条目往返计入链长`; `chain-05：request 进度计入链长`; `chain-06：request 进度不受链长限制`; `chain-07：人类决定不受链长限制`; `chain-08：邀请不归属任何链`; `chain-09：旧的成员级熔断不再阻断`; `chain-10：旧日志中的 breaker/reset 照常重放`; `chain-11：引用条目时取引用那一刻的链长`; `chain-12：命令时判定与重新加载一致`; `chain-13：并发的条目事件不越过上限`
- [ ] 3.2 Write failing tests (changed behavior): `auth-04：已移除的 internal purpose 被拒绝`; `auth-06：公开命令与授权表一致`; `auth-12：internal 不能执行成员命令`; `auth-15：host-index 不能执行任何写命令`; `auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN`; `lifecycle-05：无人接手关闭`; `lifecycle-06：主动关闭后只读`; `idempotency-07：成员与旧 internal 收据互不冲突`; `wake-01：需回复消息叫醒收件人`; `wake-04：邀请叫醒被邀请者但不授予读取权限`; `wake-05：Leader 转交不叫醒新 Leader`; `projection-05：投影不再出现 paused`
- [ ] 3.3 Implement as one batch: `chainCheck` 经 `reduce` 计算并在事务内拒绝 `COLLAB_THREAD_LIMIT`（豁免 confirmDecision/advanceRequest）；`delivery.thread` 与 `pointer.thread` 取同一值；Leader 转交不唤醒；删除 `wakeCount` 门控、`paused`、`BREAKER_LIMIT`、`resetBreaker`、`breaker-reset` purpose 及其授权表行；同批删除 `breaker.test.ts` 并改写引用 `resetBreaker` 的既有测试与类型夹具
- [ ] 3.4 Refactor; full suite stays green（3.1/3.2 全绿；此后其它已被本批满足的断言允许起始即绿）

## 4. dsh-collab 适配

- [ ] 4.1 Write failing tests: `tool-07：ref 原样传给内核`; `tool-09：超出链长原样返回`; `wake-05：话题唤醒携带链起点`; `wake-06：非整数 thread 不被转发`; `status-shape-03：request 待办带条目 seq`; `status-shape-04：request seq 只取自重放推导`; `surface-04：新增 ref 参数后仍在预算内`
- [ ] 4.2 Implement: 两个工具加可选整数 `ref`（出现时原样传）与 `collab_send_message` 描述句；provider 仅转发安全整数 `thread`；`collab_status` 的 request 待办带 `seq`（取自 `itemSeq`）
- [ ] 4.3 Refactor; full suite stays green；`test:components` 中真实 header 体积 ≤ 4200

## 5. 打包、文档与配置

- [ ] 5.1 Write failing test: build-artifact/sync-artifact 断言 `lib/v3.md` 存在且与源字节一致
- [ ] 5.2 Implement: `tsdown.config.ts` 复制 v1/v2/v3（替换写死的 `['v1.md','v2.md']`）
- [ ] 5.3 Refactor; full suite stays green
- [ ] 5.4 Run: 更新 dsh-collab README（中英）与 `dsh.yaml` note（去掉"每成员6次熔断""约定v2"，写链长 20、`COLLAB_THREAD_LIMIT`、`ref`、Leader 转交不唤醒）；仓库文档治理测试通过
- [ ] 5.5 Run: 归档时把 collab-kernel spec Purpose 中"投递与熔断"改为"投递与链长上限"（记入归档清单）

## 6. 验证

- [ ] 6.1 Run kernel test + typecheck；confirm passes
- [ ] 6.2 Run dsh-collab test + typecheck + `test:components`；confirm passes
- [ ] 6.3 Run 根 `npm test`、`npm run check:artifacts`；与 0.1 基线比较无新增失败
- [ ] 6.4 Run `openspec validate collab-ref-threads --strict`；test-plan 所有行为 🟢
- [ ] 6.5 Run 真实 Host 验收（`dsh build` + 重启后）：旧暂停成员恢复；同链第 21 环收到 `COLLAB_THREAD_LIMIT`；不写 ref 从 1 计；Leader 转交不唤醒；request 在链满后仍可推进

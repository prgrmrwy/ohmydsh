# Tasks

## 1. 持久迁移

- [ ] 1.1 在 `src/host/locus/delivery.ts` 新增 `abandonRefusedDelivery`（仅 `current` → `failed`，`failureReason: 'reply-refused'`，revision 递增，已终态/非 current/revision 不符返回 unchanged），repository 暴露对应原子方法；先写失败单测（正向、已终态、非 current、revision 不符、correlation 不符），再实现，`npx --no-install vitest run` 对应文件通过

## 2. 记录与清除本轮拒绝

- [ ] 2.1 `src/host/tools.ts`：`logAuthorizationRefusal` 增加可选 `{childSessionId, turn}`（finish 被拒时由当前 execution 填入）；既有调用方与测试不变，typecheck 0 错误
- [ ] 2.2 `src/index.ts`：维护进程内 (child, turn) → deliveryId 标记；拒绝时只在该 child 有唯一持久 current 时记录；finish 成功或 wait 成功时删除同 (child, turn) 标记。单测覆盖：无 current/多个 current 不记录、成功后清除

## 3. turn-end 收尾

- [ ] 3.1 监听 child 的 `turn/end`：存在标记时重读持久 current，仍为同一 deliveryId 则调用 1.1 迁移；成功后复用既有终结后路径撤销 capability、失败反馈、`dispatchNext`。先写失败测试：被拒后结束 → `failed/reply-refused` 且下一条成为 current；被拒后同轮成功 finish → 按成功终结；被拒后成功 wait → 保持 current；普通结束无拒绝 → 保持 current；收尾与过期竞争 → 只终结一次
- [ ] 3.2 日志只含原因码；反馈失败不阻断收尾（测试注入反馈抛错）

## 4. 验证与部署

- [ ] 4.1 Pet typecheck 0 错误、默认全量通过（基线 3319 通过、0 失败）、编译图 production/wiring/managed-effects 全绿、`git diff --check`、`openspec validate pet-locus-refused-reply-releases-queue --strict`
- [ ] 4.2 本机 `dsh build`（第二次无变化）+ 脱离进程组重启 Host；日志无降级
- [ ] 4.3 真机：在测试群构造一次 finish 被拒并结束本轮（或以现役日志/会话证据确认首次自然发生时的行为），核对 Delivery 终态、失败反馈与下一条立即派发
- [ ] 4.4 delta 合入 `openspec/specs/pet-locus-collaboration/spec.md` 并归档

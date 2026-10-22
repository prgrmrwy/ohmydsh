# Tasks

## 1. 持久迁移

- [x] 1.1 在 `src/host/locus/delivery.ts` 新增 `abandonRefusedDelivery`（仅 `current` → `failed`，`failureReason: 'reply-refused'`，revision 递增，已终态/非 current/revision 不符返回 unchanged），repository 暴露对应原子方法；先写失败单测（正向、已终态、非 current、revision 不符、correlation 不符），再实现，`npx --no-install vitest run` 对应文件通过

## 2. 记录与清除本轮拒绝

- [x] 2.1 `src/host/tools.ts`：保留日志回调，新增独立 `onFinishRefused(execution)` / `onDeliveryContinued(execution)`；只通知授权拒绝的 finish，managed guard/参数错误/wait拒绝不通知；真实执行对象测试与 typecheck 通过
- [x] 2.2 `src/index.ts`：经 token-bound adapter 捕获真实 child/turn，observer 精确轮关联匹配持久 current 才记录；成功 finish/wait 设置本轮 continued（含 wait 先成功再拒绝）。覆盖无/多 current、旧代际、纯 GUI、迟到旧 A 不消费 B，及真实插件装配

## 3. turn-end 收尾

- [x] 3.1 监听 child 的 `turn/end`：存在标记时重读持久 current，仍为同一 deliveryId 则调用 1.1 迁移；成功后复用既有终结后路径撤销 capability、失败反馈、`dispatchNext`。先写失败测试：被拒后结束 → `failed/reply-refused` 且下一条成为 current；被拒后同轮成功 finish → 按成功终结；被拒后成功 wait → 保持 current；普通结束无拒绝 → 保持 current；收尾与过期竞争 → 只终结一次
- [x] 3.2 日志只含原因码；反馈失败不阻断收尾（测试注入反馈抛错）

## 4. 验证与部署

- [x] 4.1 Pet typecheck 0 错误、默认全量通过（基线 3319 通过、0 失败）、编译图 production/wiring/managed-effects 全绿、`git diff --check`、`openspec validate pet-locus-refused-reply-releases-queue --strict`
- [x] 4.2 本机 `dsh build`（第二次无变化）+ 脱离进程组重启 Host；日志无降级
- [x] 4.3 真机：在测试群构造一次 finish 被拒并结束本轮（或以现役日志/会话证据确认首次自然发生时的行为），核对 Delivery 终态、失败反馈与下一条立即派发
- [x] 4.4 delta 合入 `openspec/specs/pet-locus-collaboration/spec.md` 并归档

# 完整隔离 profile 的工具包装层审计

2026-11-03，task 1.5。使用退役四补丁后的 rc.2 隔离 launcher output-v3，先在 Worktree Session 专属 home 执行 `dsh build` 与 `ws prepare-preview`，再通过明确的 `DSH_BIN` 选择这份已验证 launcher。未创建或移动正式 `.launcher` 指针，未操作日常 3080。实际预览地址为 `http://127.0.0.1:3254`。

[探针](full-profile-wrappers.mjs)作为 Node preload，在真实 Cordis EventService 注册时保存原 callback（注册后 callback 会被 Proxy 包装，直接 `toString()` 只得到 native code）。加载实际完整 Web profile，创建两个空普通会话，分别展开 `standard`、`locus-base`，未提交用户 prompt、未调用 LLM。结果 `observed`，无错误；原始 callback JSON 留在未跟踪的隔离构建证据目录，不提交会话或凭据。

## 实际注册结果

| 阶段 | owner | 工具体之前的行为 |
|---|---|---|
| tools/execute | timeout-policy | 建立 deadline 后调用 next；其 `await next()` 等待的是内层完成，不是额外的执行前等待 |
| tools/execute | session-checkpoint-policy | 对有 agent 且无 parent 的顶层调用，**先 await sessions.flush(agent.session)，再 next** |
| tools/execute | dsh-auto-model-routing | 读取、本地文件和命令工具直接 next；委派路径才进入 delegation.run |
| tools/pre-execute | tool-jobs | 同步设置输出限制，再 next |
| tools/pre-execute | workspace-changes | 有 recorder 时等待 recorder.settled；此阶段位于同步守卫判定之前 |

checkpoint callback 的原始关键路径：

```js
async (exec, next) => {
  if (exec.agent === undefined || exec.parent !== undefined) return next()
  await ctx.sessions.flush(exec.agent.session)
  if (exec.signal.aborted) return abortedBeforeDispatchResult()
  return next()
}
```

## 结论与边界

实际完整图存在会在工具体之前等待的 `tools/execute` 包装层。它来自官方 profile，仓库内仅搜索自研插件注册不能发现它。官方顺序为 pre-execute → 同步守卫 → tools/execute → checkpoint flush → 工具体，因此 task 1.5 的“读取、本地文件/命令工具路径上无等待包装”条件不成立。

这段等待同样位于 Pet 项目读取守卫和 Worktree Session 同步守卫之后。超时策略会检查取消信号，但没有重判全部工具守卫。Locus 的首 prompt 绑定屏障位于 pre-execute，不是本次发现的守卫后等待。

本探针用于确认实际注册与顺序，未执行软链接竞态攻击，也未声称能保证无竞态。按任务 1.5 停留在所有者决策点：接受包含 checkpoint flush 的时间窗，或另行设计 Pet 内层重判。此前接受“四补丁退役的总体时间窗”保留；本次不自动把新增实测证据视为已获进一步放行。真实飞书交互与 task 27.3/27.4 不属于本次审计。

## 所有者决定

2026-11-03：所有者选择接受包含 checkpoint flush 的时间窗，继续全退役，不增加 Pet 内层重判。

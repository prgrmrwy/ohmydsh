# 上游 Discussions 帖子（已发布）

**已发布：#7508 — https://github.com/deepseek-ai/deepseek-harness/discussions/7508**（2026-09-22，Ideas 分类）

**已交叉引用到 #5360**（该帖已有活跃讨论，独立新帖曝光有限）：https://github.com/deepseek-ai/deepseek-harness/discussions/5360#discussioncomment-18554377

- 目标仓库：`deepseek-ai/deepseek-harness` → Discussions（Issues 面板已关闭，`CONTRIBUTING.md` 明确不接受外部 PR）
- 建议分类：Ideas（这是能力请求，不是缺陷报告）
- 关联线索：#5360（方向相反：要求在 `running→waiting` 时**增加**父可见通知）
- 脱敏检查：不含主机名、路径、内网地址、凭据、产品内部命名；只引用公开发布物与公开 tag 源码
- 核心诉求：**silent**（完全不投递），不是"换一种投递方式"

---

## 标题

`Allow a caller to opt out of the settlement notice when the host owns the child's reporting channel`

---

## 正文

**Version:** `@deepseek-ai/dsh-subagent` 0.1.5-rc.2 (behavior identical in the 0.1.2-rc.1 published artifact)

### What I'm asking for

An opt-in way for the **creator** of a continuable child to say: *"do not deliver a settlement notice to the parent for this child."*

Concretely, an optional field on `ContinuableStartSpec` — e.g. `settlementNotice?: 'notify' | 'silent'`, defaulting to `'notify'` so today's behavior is unchanged — persisted in the durable descriptor alongside the per-child options that already survive cold resume (`toolFilter`, `persona`, `agentOptions`).

### The scenario it's for

A host integration where **the child's outcome is already delivered to its real audience through a channel the host owns** — a chat surface, a ticket update, a webhook. The parent is not the audience and never was.

The shape that makes this hurt:

- the parent is a **long-lived session a human is actively working in**, not a throwaway orchestrator;
- that one parent owns **several** continuable children serving different destinations;
- each child, on settling, delivers a notice to the parent.

Today that notice reaches a non-idle parent through `steer`:

```ts
// continuation-activation.ts — notifySettlement
this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
```

and `steer` is documented as *"Submit steering for the nearest step. … a running driver consumes it at its next step boundary."*

So every child settlement lands inside whatever turn the human's session is currently running. With N children that's N interruptions of unrelated in-progress work, carrying information the parent has no use for — the outcome was already reported elsewhere.

### Why the existing outs don't cover it

I checked each of these against both 0.1.2-rc.1 and 0.1.5-rc.2 before posting:

- **`activation.announced`** — documented as *"Whether any delivery to this child was ever accepted. A materialization rolled back before its first acceptance is a child the caller was told does not exist, so its teardown owes the parent no settlement account."* That is a *"this child never really existed"* gate. My children very much existed and did real work; they just reported somewhere else. Semantically the wrong switch.
- **`parent === undefined`** — would suppress it, but only by making the parent non-live. Not something anyone should engineer for a session a human is using.
- **`closingTeardownFor(parent)`** — this branch uses `parent.inject(...)`, but its condition (parent already tearing down) is unreachable for a healthy long-lived parent.
- **Intercepting in `sendWaking`** — when the parent is a plain root agent rather than a resident activation, `sendWaking` falls through to `parent.steer(message)` directly, so there is no intermediate object to interpose on.
- **Cleaning up on the parent side afterwards** — `subagent-settled` is a public message source kind, so a host can recognize and remove the entry; but by then the steering has already been consumed at a step boundary. That removes the transcript line, not the interruption.
- **Switching the delivery to `inject` instead of `steer`** — I considered proposing this as the smaller change, then ruled it out: `inject` and `steer` differ only in the `wakeup` flag (`agent-loop/src/agent.ts`, both target `next-step`). It removes the extra wake, but the message still enters the parent's in-flight turn at the next step boundary. For this use case the requirement is that the parent's current work is untouched, so opting out entirely is the only thing that satisfies it.

### Why opt-in rather than a default change

I'm explicitly **not** proposing to change what parents see by default. A parent that has no other visibility into its children should keep getting the notice — that's the right default, and #5360 argues for even more parent-visible signal, which I agree with for its scenario.

The request is only for callers that have taken on the reporting responsibility themselves to be able to say so. That's also why the descriptor needs to carry it: after a cold resume the runtime has to still know this child's outcome is somebody else's job.

### Relationship to #5360

#5360 asks for the opposite direction — an **additional** parent-visible notice on the `running → waiting` transition, so a parked manager stops falling off its supervisor's radar.

I don't think these conflict, and I'd rather they be considered together: that request is about **making sure a parent learns about a child it would otherwise lose track of**; this one is about **letting a caller that already reports elsewhere decline a notice it doesn't need**. Both point at the same underlying gap — settlement delivery currently has exactly one policy, and whether that policy is right depends on who owns the child's reporting channel.

### Notes

- Not a regression: `notifySettlement` is byte-identical in the 0.1.2-rc.1 published artifact, so this has always been the behavior.
- Happy to provide a minimal reproduction (one long-lived parent mid-turn, two continuable children settling) if useful.
- I understand external PRs aren't accepted; posting here per `CONTRIBUTING.md`. If the shape is acceptable I'm glad to share the exact diff I'm running locally for reference.

---

## 发布前检查清单

- [x] 用户确认发布
- [x] 复核所有引用的文件路径与行为描述对 `dsh-v0.1.5-rc.2` 仍然成立
- [x] 确认 #5360 当时状态（发布时复核：open、未 answered、3 条评论，与草稿一致）（本草稿写作时：open、未标记 answered、3 条评论）
- [x] 确认不含任何本机路径、主机名、内部服务地址或产品内部命名
- [ ] 发布后把 discussion 编号与链接回填到本 change 的 `proposal.md` Impact 段与 `dsh.yaml` 的 `removeWhen` 记录

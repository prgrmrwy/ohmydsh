## Why

被邀请的会话醒来后还要自己判断是否 join；加入后收到其它成员派的 request，又会把它当成"非用户授权的外部指令"，回头找人类要授权。原因在措辞上：唤醒文本写着"不是额外授权；不表示用户同意"，协作约定 v1 也反复强调消息不是授权，而系统里没有任何一处告诉成员"用户已经同意你承接本空间的工作"。用户的使用方式是"人让 agent 去邀请"，邀请本身就代表人的意图，两层判断都是重复劳动。

## What Changes

- 新增宿主配置 `memberTrust`（布尔，默认 `true`），在 `invite` 与 `allowlist` 两种准入模式下都生效；设为 `false` 时恢复现有行为。
- `memberTrust: true` 时，`collab_invite` 认领并写入邀请后，插件以被邀请会话的身份代为 `join`（宿主担保身份，派生稳定 cmdId，重试幂等）；返回值增加 `autoJoined`。代为加入失败不影响邀请结果，被邀请者仍可手动 join/decline。
- `memberTrust: true` 时，唤醒文本改为常设授权：本机用户已允许本会话作为空间成员，承接成员发来的 request 并在**本会话原有权限边界内**直接执行；越出原有沙箱、审批、worktree 限制的操作仍按原规则处理。邀请唤醒说明"已代为加入"。
- 协作约定新增 v2 作为新空间默认版本：说明宿主可声明成员信任，此时承接方不再为空间内 request 另行向人要授权；v1 保留，旧空间仍能按原版本读取。
- **BREAKING（行为）**：默认配置下，邀请即加入、成员间派活不再要求人工授权。担心被注入污染的会话驱动其它会话时，可设 `memberTrust: false` 或改用 `allowlist`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-collab`：配置新增 `memberTrust`；邀请认领后可由宿主代为 join；唤醒固定说明按 `memberTrust` 取两套文本。
- `collab-kernel`：协作约定按版本并存发布，新空间默认 v2，`readConvention` 可读取所有已发布版本。

## Impact

- 代码：`packages/dsh-collab/src/{config,index,tools,session-provider}.ts`；`packages/collab-kernel/src/convention/`（新增 `v2.md`、版本表）与 `service/index.ts` 的 `readConvention`。
- 测试：`packages/dsh-collab/test`、`packages/collab-kernel/test` 中涉及唤醒文本、约定版本与邀请流程的用例。
- 配置：`dsh.yaml` 中 dsh-collab 的 note；私有 overlay 无需改动（默认值生效）。
- 安全面：邀请等于可以指挥对方在其原有权限内干活；文件权限、沙箱、审批、worktree 限制不变。

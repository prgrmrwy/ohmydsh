## Why

真实答疑群中，Locus child 的受管 `pet_locus_finish` 曾在 Delivery 仍为 current 时被统一拒绝，模型随后经 `bash`/`lark-cli` 旁路直发飞书，造成群里有回复而 durable Delivery 过期；同时只读 child 无法可靠读取截图，且现有意图澄清条文与“业务正文唯一由 finish 发出”的契约互相冲突。需要先把这组 P0 问题收敛为可复现、可诊断、不可绕过的 Delivery 安全闭环，再继续做排队体验和回复体例优化。

## What Changes

- 为 current Delivery 的 caller capability 增加可判定诊断与真实时序回归：区分没有 current、GUI/user 混入、claim 尚未绑定、队列晋升/到期竞争、代际陈旧和恢复关联缺失；保留 GUI mixed fail-closed，不把“durable current”误当成任意 turn 都可 finish 的充分条件。
- 将 Locus 业务出站唯一性从提示约定提升为可执行边界：Locus child 不得借 Skill、shell、脚本、CLI 或其它外呼路径直接发送/撤回飞书业务消息；只有 caller-bound `pet_locus_finish` 可发送正文。实现前先核验 pinned runtime 能否提供不误伤必要代码读取/调研能力的强隔离接缝，无法证明时保持能力不可发布，不能用命令字符串黑名单冒充安全保证。
- 为 read-only Locus 增加 Host-owned、caller-bound 图片读取：使用固定源码私有 `lark-cli` 1.0.94 compat 的 `--output-fd + --max-bytes` no-path seam，将图片经匿名 pipe 有界交给 Host、保存到 DSH attachment 并作为 typed image 投递；compat/provenance/attachment 任一不可证明时媒体 fail closed，文字 Delivery 继续。
- 修正意图分流为四类：信息交换、要求干活、仅提示关联（reference-only）和确实歧义。仅提示关联时以 `pet_locus_finish(no-reply)` 静默结算并推进队列；同时 @ 多个 bot 时保留结构化 mention 事实供 child 判断，Host 不用关键词替模型分类。
- **BREAKING**：澄清回复改为经 `pet_locus_finish(reply)` 结算当前 Delivery；用户后续 at 是新的 Delivery，但由同一长期 child 历史继续理解。移除“普通 assistant 文本可发澄清且保持同一 current”这一无法由现有出站契约实现的语义；未获后续答复时不再承诺自动登记待办。
- 本 change 不实施排队/失败文字回执、Meego preflight、parent lookup 分页或群回复精简。群回复“首句结论 + 适量相关上下文 + 按需展开”与此前长度优化合并为后续渐进披露事项。

## Capabilities

### New Capabilities

- `pet-locus-media-access`: 当前 Delivery 绑定的飞书图片等媒体如何由 Host 受控取得、验证、持久引用、注入和降级，而不放宽 read-only 文件策略。

### Modified Capabilities

- `pet-locus-collaboration`: 补充 caller capability 的可判定拒绝、旁路出站隔离、结构化 mention 事实及唯一回复出口的不变量。
- `pet-locus-intent-triage`: 增加 reference-only 静默结局，并把澄清改为结算当前 Delivery、后续 at 作为新 Delivery 继续同一 child 历史。

## Impact

- Pet Host：`src/host/locus/turn-observer.ts`、caller-bound tools、Delivery/context/prompt、channel event/admission/controller、child scoped composition 与 Lark adapter。
- DSH runtime 接缝：agent-scoped `tools.guard`/tool restriction、subagent composition、sandbox/网络/凭据边界、`ctx.attachments` 与 typed image content；任何 compatibility 扩展必须针对当前精确 pin 核验并 fail closed。
- 数据：Delivery 需保存最小结构化 mention 与媒体引用/诊断事实；schema 只做 additive 演进，旧 Delivery 保持可读，不回填媒体。
- 测试：复刻三次历史 finish 拒绝时序；覆盖 GUI mixed、claim-before-bind、expiry→promotion、Host 恢复、旁路尝试、图片注入、reference-only no-reply 与澄清的新 Delivery 语义。
- 安全：不开放通用 scratch，不允许模型指定 chat/message/media target，不把字符串命令过滤、prompt 提醒或 read-only 文件沙箱表述为飞书出站隔离。

## Context

Unified Pet locus 已把飞书入口建模为「parent session → group/thread locus → persistent child」，每个 locus 只有一个 current Delivery，正文由 caller-bound `pet_locus_finish` 原子结算。当前痛点并非缺少这套模型，而是四处边界没有闭合：

1. `currentCapabilityForChild()` 的 turn 证明与 durable current 之间缺少可判定诊断；真实会话里连续出现“Delivery current 但 finish 被统一拒绝”，无法区分 race、旧 turn、mixed 或恢复失败。
2. child 保留通用 `bash`，而同 UID/read-only 文件策略不能隔离本机 `lark-cli` profile、脚本和网络；一次 finish 拒绝后模型已通过脚本旁路发送，导致群里已答、ledger 却 expired。
3. read-only child 不能经 CLI 下载截图，而现有 Lark adapter 又只给压平文本。DSH 已有 durable `AttachmentStore` 和 typed image block，但 Pet 未接入。
4. intent spec 要求澄清“不结算 current”，prompt 又让普通 assistant 文本发澄清；Delivery spec 明确普通文本不外发，实际验收则用了 `finish(reply)`，三者矛盾。与此同时，多 bot mention 在 admission 后丢失，模型无法可靠识别“本 bot 只是联系人提示”。

关键约束：GUI/user mixed 必须继续 fail closed；Host 不做关键词意图分类；read 权限不得通过 `/tmp` 或项目写权限变相放宽；active `pet-locus-independent-agent-inquiries` 仍未交付，不能依赖它；兼容扩展只针对 `dsh.yaml` 的精确 DSH pin。

## Goals / Non-Goals

**Goals:**

- 复现并分型 finish 拒绝，在不削弱来源隔离的前提下修复可证明的 claim/bind、跨 turn、晋升与恢复时序。
- 让 `pet_locus_finish` 成为执行层面的唯一飞书业务出站，不再只是 prompt 约定。
- 让 read-only child 能安全查看当前请求绑定的图片。
- 保留结构化 addressing 事实，支持模型区分 info/work/reference-only/ambiguous；reference-only 静默结算。
- 统一澄清语义：当前 Delivery 以澄清回复终结，后续回答是同一 child 的新 Delivery。

**Non-Goals:**

- 不开放 locus write，不重做 Delivery 队列/lease，不增加正文失败通知。
- 不实现任意飞书历史或任意 file key 下载；不承诺首版解析 PDF/压缩包/音视频。
- 不做 Host 关键词分类或自动判断 reference-only。
- 不实现“同一 Delivery 等待用户回答”的 `waiting-user` 状态机，也不在用户沉默时自动建待办。
- 不实施 parent lookup 分页、Meego preflight 或群回复长度硬截断。回复优化保留为后续“首句结论 + 必要上下文 + 按需展开”。

## Decisions

### 1. capability 采用「durable 事实 + 当前执行 provenance」双证明，并输出稳定拒绝码

保留现有 fail-closed 架构：repository 证明唯一 active locus/generation/current，turn observer 证明这次执行来自该 current 或其合法连续轮次。`resolveAuthorized()` 不再把所有失败折叠为一句话，而是返回内部 discriminated result；工具层再映射为不泄露其它入口的用户文字。

最小拒绝码为：`no-current`、`claim-unbound`、`mixed-source`、`stale-delivery`、`generation-mismatch`、`association-unproven`、`capability-unavailable`。observer 对“claim 先到、bind 后到”保留可恢复 unresolved，不把它 sticky 地写成 mixed；真正 GUI/user/foreign pollution 仍 sticky fail closed。

先用 runtime-level tests 重演：同一步 claim/bind 顺序、`next-step`/`next-turn` batching、原始 turn 结束后的 Host/agent-message、expiry→promotion、Host 冷恢复。只有测试证明是哪条时序丢 proof 后才改 observer；不得以“数据库 current 即授权”修复。

**备选：** 只改善错误文案。拒绝，因为既不能定位 race，也无法证明修复没有放宽 GUI mixed。

### 2. 出站隔离先设硬闸门；基线选择无任意进程执行的 Locus safe composition

当前 pinned runtime 的 file sandbox 只约束写入，不约束读取 profile 或网络；`shellEnv` 只注入 `DSH_*`；agent-scoped guard 能可靠按完整 tool name 静态拒绝，但不能安全理解任意 shell command。因而“保留通用 bash，只禁 lark-cli/msg.py/curl”不是可接受边界。

实施分两条路线，第一条是发布基线：

- 为 locus child 固定持久 safe composition，deny `bash`、`pwsh`、run-code/任意进程执行、subagent/fork/workflow/Ralph/send-message 等可洗白 authority；保留 DSH 一等只读 `read/glob/grep/read_image`（若 route 支持）、必要 web 读取与 caller-bound Pet tools。
- restriction/guard 必须从 child publication 前持续到 disposal/冷恢复；Pet 自己在 child scope 注册的 caller-bound tools 不受 inherited global restriction 误删。
- 当前 subagent seam 不能显式指定另一个持久 child preset；因此需要最窄 compatibility seam（例如持久 `toolFilter`/明确 safe composition override）并加 pin probe。不能证明安装成功则拒绝 child publication。

第二条仅作为可选后续 gate：若一定保留通用 bash，必须先证明 child 在独立 execution world 中无法读取 Pet Lark 凭据/profile，并且到 Lark API 的 egress 被拒绝，而 Host broker 仍可发送。独立 HOME、PATH 隐藏、命令字符串 deny 都不算证明。该 gate 未过，不发布“bash + 唯一出站”。

**备选：** 只移除 Lark Skill。拒绝，shell 仍可调用 CLI/脚本。**备选：** 静态扫描 command。拒绝，alias、解释器、绝对路径、复制脚本和 HTTP 均可绕过。

### 3. 图片通过固定源码私有 lark-cli 的 bounded inherited-fd seam 进入 DSH attachment

当前全局 `lark-cli` 1.0.94 只支持具名输出路径，无法形成同 UID cross-agent 隔离。本 change 不替换用户全局 CLI，而是按固定 tag `v1.0.94`、精确 commit 与 patch SHA 构建 Pet 私有二进制；compat 只给 `im +messages-resources-download` 增加隐藏且配对的 `--output-fd` / `--max-bytes`。普通路径下载行为不变。

fd 模式仅在 POSIX 接受 inherited fd >=3，与 `--output` 互斥。CLI 在已知 Content-Length 超限时读前拒绝，否则以 `LimitedReader(max+1)` 流向 fd；超过上限、长度不符或写失败均非零退出，stdout 只输出小型 JSON receipt。Pet 从包内 artifact/provenance 解析绝对 binary，绝不回退 PATH；artifact 缺失、版本/平台/patch/capability 不符时 media port unavailable。

Host 从 durable Delivery 固定 message ID 枚举当前消息图片，以 detached child fd3 匿名 pipe 收取 bytes，同时按单图和消息剩余额做第二层有界累计；超限、Abort、timeout 均关闭 pipe 并终止整个进程组。magic MIME 与 `AttachmentStore.saveImages` 完成解码/像素/数量/总 bytes 验证，按 occurrence 顺序产生 typed image blocks。全过程无具名媒体文件，枚举前、保存前和最终入队前重验 exact current。

固定文本模型拒绝 typed image 时，只对 `image-route-unsupported` 在同一 current 上重试一次纯文字 prompt并明确未查看图片；其它拒绝不重试，fallback 前和最终 queue seam 再验 current。

safe child 仍同步安装 canonical project-read guard，限制项目读取到 Host 一致证明的单一 root并拒绝 DSH/Pet/attachment roots；这是额外最小权限加固，不再作为媒体匿名 pipe 的隔离依据。

**备选：** 具名 cache + 随机名/0600/TTL。拒绝，同 UID 普通 Agent 可读取。**备选：** 替换用户全局 CLI。拒绝，扩大升级和行为影响；私有 artifact 只供 Pet media 使用。**备选：** 修改 DSH core。拒绝，缺口在 producer 的 no-path 输出，Pet 的 Host-owned spawn 已能管理匿名 pipe和进程树。


### 4. addressing 保存规范化投影，不保存整份 transport event

`NormalizedLocusMessage` 和 Delivery 增加有界有序 projection：occurrence 的 `kind` 与 display name，加 `selfMentioned`/`otherBotCount`。Host 以 event mentions + `listChatBots` 分类；不能证明的标 `unknown`。稳定 ID 仅 Host 内部审计/重验，prompt 不暴露无关 open ID。

模型看到文本及 addressing projection，自行四分：info、work、reference-only、ambiguous。Host 仍只负责 admission（必须 mention self）与 durable enqueue，不因 another-bot 或关键词提前丢弃。

**备选：** 只给 `alsoMentionedBots=true`。拒绝，无法表达顺序、参与方类型和 unknown。**备选：** 保存完整 webhook。拒绝，schema 耦合且披露过度。

### 5. reference-only 是 `finish(no-reply)`，不是 wait

reference-only 没有未来工作需要等待。child 调 `pet_locus_finish({ outcome: 'no-reply', reason })`，CAS 结算并推进，不发正文。`pet_locus_wait` 只用于当前任务确实仍在处理，不能拿来实现沉默；否则会堵塞队头直至 deadline。

### 6. 澄清是当前 Delivery 的终局，新回答是新 Delivery

澄清只经 `pet_locus_finish(reply)` 发送，所以发送、ledger、队列推进保持一个出口。后续用户 at/reply 正常形成下一条 Delivery；persistent child 的历史保存了问题和澄清，足以继续理解。删除“普通 assistant 回复会发到飞书”“不结算 current”“无人回复自动建 todo”的 prompt/spec 文案和伪验收。

**备选：** 新增 intermediate clarification tool 和 durable `waiting-user`。这需要中间出站 CAS、clarification message ID、选择性把回答路由回旧 current、backlog 公平性和 timeout hook，超出 P0；若未来确有单 Delivery 跨澄清需求，应单开 change。

## Risks / Trade-offs

- [移除 bash 会降低 child 的现场调研能力] → 保留结构化只读工具；缺失的必要读取能力通过 caller-bound Host broker 增补，不用通用 shell 换安全性。
- [safe composition 需要当前 runtime 没公开的持久 override seam] → 作为 Gate O1，优先最窄 compatibility patch；probe 不通过则 Locus unavailable，不回退父 preset。
- [可选保留 bash 的隔离成本高] → Gate O2/O3 只接受独立 UID/container/credential broker/egress policy 的实证；本 change 基线不依赖它。
- [project-read guard 收紧了 Locus child 的文件读取范围] → 只允许 Host 一致证明的 project root；缺失事实直接 veto publication，不以读取 DSH/Pet 私有目录换便利。
- [私有 lark-cli artifact 增加构建与包体成本] → 固定源码/commit/patch/toolchain SHA、共享构建锁、原子 artifact 发布和运行时 provenance probe；不替换全局 CLI。
- [bot/human 分类需要成员 API且可能失败] → `unknown` 是一等值，模型在不确定时澄清；不从文本猜。
- [澄清变成两条 Delivery，backlog 中可能夹入他人消息] → 接受既有 per-locus FIFO，行为真实可解释；不伪造同一 current 连续性。
- [旧 Delivery 没有 addressing/media 字段] → additive schema、读取默认 unknown/empty，不回填不重放。

## Migration Plan

1. 先添加 runtime probes 和黑盒复现测试；不改变生产行为。
2. 落地稳定 capability 诊断与 observer 时序修复，保留 GUI mixed 回归。
3. 完成 Gate O1：持久 safe composition。若需要，增加精确 pin compatibility patch；probe 未过时保持 Locus intake unavailable。
4. 安装 safe composition，并用真实负向测试验证 shell、解释器、HTTP 与子委派均不可达；确认 `pet_locus_finish` 正常。
5. additive 迁移 Delivery addressing/media 字段；旧行按 unknown/empty 读取。
6. 构建并探针验证私有 patched lark-cli，启用 inherited-fd 图片下载与 `ctx.attachments`；覆盖双层限额、进程树取消、文本模型降级和 current 竞争。
7. 更新 intent prompt/spec tests，发布 reference-only 与新澄清语义。
8. 在现有 Web URL 刷新后验证管理诊断（若 UI 有变）；不启动替代服务器。

回滚时先停止新 intake，再撤媒体/意图投影；保留 additive 数据。safe composition 与唯一出站不得单独回滚为继承父 preset；如果 compatibility seam 回滚，Locus 应回到 unavailable，而不是恢复不安全 child。

## Open Questions

- Gate O1 的最窄实现应扩展 subagent continuation 的持久 `toolFilter`，还是允许 Host 显式指定 child preset？实现 spike 以冷恢复可证明性和改动面作选择。
- 平台 adapter 是否能提供可靠 mention occurrence 顺序/span；不能时 projection 顺序标 unknown，不阻塞 kind 分类。
- 可选 Gate O2（保留 bash 的独立 execution world）不阻塞本 change 的无 bash 基线；只有用户另行要求保留通用 bash 时才推进。

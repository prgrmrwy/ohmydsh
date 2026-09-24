## Why

群里 bot 回复开头的「@赵鸿珂」是**纯文本**：飞书不把它当 mention，对方收不到提醒、也点不动。实测（2026-09-16 01:11:44，答疑群）：

- 消息原文正文为 `@赵鸿珂 7375520107（主对话 @ 卡片点「查看主页」跳错）看完了…`，`im/v1/messages` 返回 `mentions: null`；
- 同一 bot 前一天 00:51:02 那条却是真 mention（`mentions: [{id: ou_854a…, key: "@_user_1", name: "赵鸿珂"}]`，正文里是占位符 `@_user_1`）——因为那条走的是 child 自己用 lark-im-live 的发送脚本、并手写了 `<at user_id="ou_…">` 标记（该 skill 记录里它还写着「上面这条补一下真实提醒（刚才 @ 没生效）」）。

根因是一条**入站/出站不对称**，而合同只在 lark-cli 的文档里、没有进入 Pet 的注入：

| 方向 | 平台契约 | 后果 |
|---|---|---|
| 入站 | `lark-cli event consume` 把 mention **预渲染成显示名**（`@小小芒果 hi`） | Agent 看到的天然就是「@名字」 |
| 出站 | 文本消息必须是 `<at user_id="ou_…">名字</at>`（`lark-im` 的 `references/lark-im-messages-reply.md` §@Mention Format；`@all` 用 `user_id="all"`） | Agent 照抄入站写法 → 只是纯文本 |

已实测两条事实：`im +messages-reply --text '<at user_id="ou_…">赵鸿珂</at> hi'` 会**原样**发成 `{"text":"<at user_id=\"ou_854a…\">赵鸿珂</at> hi"}`（标记不被转义，平台会渲染成提醒）；而 Pet 的注入里**没有任何一句**提到这个语法（`locus/context.ts`、`tools.ts` 里搜不到 mention/at 相关说明）。所以模型只能靠猜，猜错的代价是对方收不到提醒——而它根本没有反馈渠道发现这一点。

## What Changes

- **出站回复渲染真实提醒**：业务回复发送前，把正文里形如 `@<群成员显示名>` 的**整词**引用渲染为 `<at user_id="ou_…">显示名</at>`。映射只用该 chat 当前成员列表的精确「显示名 → open_id」，bot 身份读取（`im +chat-members-list`，与既有 `memberCount` 同源）。
- **严格限定改写范围**：正文已含 `<at ` 标记时整体不改写；同名歧义（多个成员同名）、非成员显示名、以及 `@` 前为词内字符（如邮箱 `a@b.com`）一律保持原文。渲染是**把 Agent 已经写出的 @ 引用翻成平台要求的标记**，不新增、不删除、不改写任何正文语义。
- **fail-soft**：成员表不可读、渲染器异常时按原文发送，只记一条不含姓名/open_id 的低基数诊断；渲染 MUST NOT 阻断发送或改变 Delivery 终态。
- **注入补齐平台契约**：统一 locus 投递提示与 `pet_locus_finish` 工具说明里写明「群内 @ 人直接写显示名即可，Host 会渲染成真实提醒；别名/备注名与群显示名不同时用 `<at user_id="ou_…">` 明确指定」。
- 非破坏性：不改持久 schema、不改 Delivery 语义、不新增信任面（只读群成员，与既有调用同一命令与身份）。

**明确不做**：不因为正文里有 `@` 就去通讯录里模糊搜索补全（跨群、跨租户的姓名解析既不可靠也扩大了读取面）；不改写卡片/富文本路径（本部署只用文本回复）；不在诊断里记录姓名或 open_id。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-collaboration`：新增「出站回复的 @ 引用 SHALL 渲染为平台真实提醒」的要求，含歧义/非成员/已标记形式的**不改写**边界与 fail-soft 行为；并在既有「文字回复由 Agent 发出」的上下文里明确 Host 只做标记渲染、不参与正文创作。

## Impact

- `packages/dsh-pet/src/host/channel/mentions.ts`（新）：纯渲染器与候选检测。
- `packages/dsh-pet/src/host/channel/lark.ts`：`listChatMembers`（bot 身份、按 chat 缓存）与 `replyToTarget` 的渲染接线。
- `packages/dsh-pet/src/host/tools.ts`、`src/host/locus/context.ts`：注入平台 @ 语法与「Host 会渲染」的事实。
- 测试：纯渲染器（唯一命中/歧义/非成员/已有标记/边界/邮箱/超长名单）、回复路径接线（渲染或不渲染）、注入文案断言。
- 用户可见影响：bot 在群里 @ 人变成真实提醒（对方收到通知、可点击），且不再依赖模型记得写标记。

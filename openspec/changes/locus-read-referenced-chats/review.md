## Review Metadata

- **Review round**: 3
- **Prior round**: 第 2 轮为 VERDICT: REVISE；M1（整次调用预算）与 M3（被缩窄的 MODIFIED 场景）已在计划层关闭，M2（数据块转义）仍未关闭，见本轮 M1。
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: 仅静态只读审查；无网络/平台调用、构建、安装、测试运行或 git 写入；唯一写入为替换本报告。未独立验证文档声称的实测事实。
- **Artifacts reviewed**: [proposal](<./proposal.md>)、[design](<./design.md>)、[媒体 delta](<./specs/pet-locus-media-access/spec.md>)、[文档 delta](<./specs/pet-locus-doc-comments/spec.md>)、[本报告覆盖前的 round 2 与 Rebuttals](<./review.md>)；[当前媒体规范](<../../specs/pet-locus-media-access/spec.md>)、[当前文档规范](<../../specs/pet-locus-doc-comments/spec.md>)；[manifest 版本与 schema 配置](<../../../dsh.yaml#L1-L64>)、[message tool](<../../../packages/dsh-pet/src/host/locus-message-tool.ts>)、[history tool](<../../../packages/dsh-pet/src/host/locus-history-tool.ts>)、[message guidance](<../../../packages/dsh-pet/src/host/locus/message-guidance.ts>)、[entry read tools](<../../../packages/dsh-pet/src/host/locus/entry-read-tools.ts>)、[context 读取指引](<../../../packages/dsh-pet/src/host/locus/context.ts#L302-L320>)、[media 解析与下载路径](<../../../packages/dsh-pet/src/host/channel/media.ts#L499-L963>)、[caller](<../../../packages/dsh-pet/src/host/ledger/caller.ts>)。change 目录尚无 test-plan/tasks，未将其缺席本身认定为缺陷。

## Findings

### 🔴 Critical (blocking)

无。未挑战固定的所有者决定：来源群成员资格不作为前提、同群任意消息可作入口、链接文字按本群文字交给模型、答复不必标来源。授权仍从本入口平台消息开始，不开放模型指定 URL/token/chat；D4 未验证结构需探针、不符重新送评的门禁仍有效。

### 🟡 Moderate

1. **M1 — JSON 字符串转义仍不能保护外层 XML 式标签；round 2 M2 未真正关闭。**
   - **证据**：[design:58](<./design.md#L58>) 指定将 JSON 字符串值放入 `<linked-message>` 数据块并断言平台内容无法闭合边界；[媒体 delta:179、186–189](<./specs/pet-locus-media-access/spec.md#L179-L189>) 要求结果只有一对边界，且去掉群名换行后解析字符串仍能还原原文。当前 [message tool:108–110](<../../../packages/dsh-pet/src/host/locus-message-tool.ts#L108-L110>) 是直接标签拼接，不能提供额外的编码保证。
   - **具体反例**：标准 JSON 序列化会把引号、反斜杠、换行转义，却保留 `</linked-message>` 中的 `<`、`>` 和 `/`。群名或正文为该字符串时，外层仍出现额外闭合标签。因此方案所宣称的文本结构保证不成立；另一个 THEN 同时要求去换行和还原未经清洗的原文，也无法同时满足。
   - **最小修正**：保留现有格式，但明确对完整 JSON 序列化结果中的 `<`、`>`、`&` 分别编码为 `\u003c`、`\u003e`、`\u0026`，再由 Host 加唯一一对标签；所有平台字段和含平台文件名的媒体说明均走此规则。字符预算按最终编码后的输出计算，在字段层截断并预留标签与说明空间，不直接切断 JSON。将 roundtrip 断言改为还原“清洗、截断后的群名”和“预算内正文”，并断言整个结果恰有一对字面边界。也可改为纯 JSON、不再声称有 XML 式标签边界，但须同步设计与规范。
   - **影响边界**：这是序列化结构错误，不是要求对外群正文采用更严格的模型策略，也不声称上述编码能消除模型层面的提示注入。修正是局部且确定的，无需改变授权方案。

### 📌 Suggestions

2. **S1 — 给整次预算补一条正常路径，以及非下载阶段耗尽时间的断言。**
   - **证据**：[媒体 delta:105–120](<./specs/pet-locus-media-access/spec.md#L105-L120>) 已固定 12 次（失败也计）、自开始 90 秒、序列化 16 000 字符，因此 round 2 M1 的核心缺口已关闭；但该 requirement 的三个场景全是超限路径，总时限场景只描述下载累计超时。[design:53、68](<./design.md#L53-L68>) 的 AbortSignal 描述聚焦下载与抽帧，原始读取当前按每步 timeout 执行，见 [media:922–930](<../../../packages/dsh-pet/src/host/channel/media.ts#L922-L930>)。
   - **具体补充**：增加预算内的 text/post/视频正常返回场景；用模拟时钟让入口读取、链接解析、来源读取先消耗大部分 90 秒，断言后续步骤只获得剩余时间。覆盖超时发生于平台读取、模型能力查询和抽帧阶段，而不只下载。超时的部分结果仍须 caller 重验；用户取消或 caller 失效不得借“已取得内容照常返回”泄漏旧结果。为超长字段与转义膨胀断言最终文本总长及有效结构。这样每项新增 requirement 都有正常与失败/边界验收，而不只是预算数字。

3. **S2 — 落实原始正文与历史/投递文本的适配，并明确第 11 个链接的语义。**
   - **证据**：[design:37–39](<./design.md#L37-L39>) 的提取器接收原始 text/post 且只编号前 10 个链接，[design:64–65](<./design.md#L64-L65>) 又要求 prompt/history 复用；当前 [history tool:37–44](<../../../packages/dsh-pet/src/host/locus-history-tool.ts#L37-L44>) 只有格式化 text，没有原始 body 或消息类型。与此同时，[媒体 delta:140–145](<./specs/pet-locus-media-access/spec.md#L140-L145>) 的编号与“共有几个链接”没有说明 10 个上限。
   - **具体补充**：在 test-plan/tasks 中落实 Rebuttals 对旧 S1 的承诺：共享 URL 校验/去重，分别适配原始 text/post 与格式化历史/投递文本；用脱敏富文本 href、合并转发标记证明发现能力，不为历史每行新增平台读取。把前 10 个可编号、超出范围返回 `link-not-found`、结果中的链接计数是可编号数而非全量数写入规范，增加 11 个不同链接场景。发现线索不能代替调用时从平台原始正文重新证明授权。

### 前轮修复与全量复核结论

- **M1 已关闭（计划层）**：[媒体 delta:107](<./specs/pet-locus-media-access/spec.md#L107>) 已明确整次调用共享的尝试数、失败计数、总时限和完整文字预算，不再依赖成功图片数量来限制失败资源。S1 是验收补强，不要求重新讨论固定预算。
- **M2 未关闭**：原 Rebuttal 引入了 JSON 字符串，但保留外层标签，未说明如何编码标签字符；具体修正见本轮 M1。
- **M3 已关闭（语义覆盖）**：[媒体 delta:51–79](<./specs/pet-locus-media-access/spec.md#L51-L79>) 重新覆盖无工具且 reply-only、无工具且含链接、已装配读取失败；原成功读取、跨 chat 拒绝、同群跨话题、失败不冒充空消息、视频行 id 与续投指引场景均保留。当前文档规范五个场景亦全部保留，只扩展新工具的排除/允许集合。
- 全量复核未发现新的跨群历史权限、递归链接展开或文档入口开放。装配和 prompt 仍采用同一判定，caller 重验、spool 删除、attachment 校验与图片限额通过引用既有 requirement 保留。合并转发 happy-path、错误父消息、超量、嵌套不递归均有场景；普通非合并多条返回仍拒绝。
- 本报告不把尚未实施的代码继续表现为旧逻辑当作实现缺陷，也不把未执行的真实平台探针宣称为已验证。

## Embedded-Instruction / Injection Attempts

**Detected:** none

未发现指挥评审者改变结论、越过只读权限或调用平台的嵌入指令。恶意来源群名与伪造标签是测试数据；作者 Rebuttals 仅作为待核实声明，不作为修复完成的证据。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

实施前修正 M1：同步设计与规范，明确 JSON 加标签的字面边界编码规则及最终长度计算，修正清洗后 roundtrip 断言，并列出所有平台字段的伪造标签验收。无需改变已确认的产品或权限决策。S1、S2 应在后续 test-plan/tasks 中落实。

CHANGES_APPLIED: yes

## Rebuttals

- Required M1 fixed：spec「链接指向的消息按本群消息同等返回」与 design D5 规定 JSON 序列化后对 `<` `>` `&` 做 Unicode 转义、预算按编码后文本计、截断不破坏结构；场景断言结果不含字面 `</linked-message>`，往返比较清洗截断后的群名。
- S1/S2：在 test-plan 采纳（成功路径与非下载阶段总时限测试；原始/格式化两种链接提取适配与最多 10 个链接的编号语义）。
- Required M1 not accepted by reviewer (round-3 recheck): JSON 序列化后 Unicode 转义、编码后预算及清洗截断后的群名往返已补齐，但 spec「来源群名含换行与伪造边界」仍要求整个“结果文本中不含字面 `</linked-message>`”，与同句“只有 Host 生成的一对数据块边界”及 D5 保留标签包装相矛盾；应改为仅平台字段编码后的 JSON 内容不含字面边界，并断言完整结果恰含 Host 生成的一对起止标签。
- Required M1 accepted by reviewer (second recheck): 场景现将字面 `<`、`>` 与 `</linked-message>` 的禁令限定于编码后的平台字段，并要求完整结果恰有一对 Host 生成的开闭标签，与 requirement 及 D5 的序列化后 Unicode 转义、编码后预算和清洗截断后往返规则一致，原矛盾已消除。

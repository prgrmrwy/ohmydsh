## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: READ-ONLY 规划评审；仅写本报告。未修改提案、设计、规范或源码；未运行构建、测试、lark-cli、网络请求或凭据操作。只读执行了 OpenSpec review instructions 与 SHA-256 指纹命令。
- **Artifacts reviewed**: [proposal.md](<openspec/changes/locus-read-message-media/proposal.md>)、[design.md](<openspec/changes/locus-read-message-media/design.md>)、[媒体 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md>)、[文档 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md>)；当前媒体、群读取、协作与文档规范；相关 media、controller、history、caller、tools、composition、context 与 Lark adapter 源码，以及媒体测试与集成陷阱文档的相关段落。未发现 OpenSpec project 文档。
- **Artifact SHA-256**:
  - proposal: `8680ef0441280d7b92a687c6040ec0bb8f3db95f9ee818732bce5dab1465d1a5`
  - design: `0c4225e2ac1f914f61f7644f106116a5f29f6524fbf53d79fb7f605c7b6975e6`
  - media delta: `fc0d83ce042e712f537740bf77ac93aa2c3860c00e47c7172bed6c4b1dae0ec1`
  - doc delta: `5cd930ba133126b1f707452b76b058b431716f5220a914fee2f859bef2a70deb`

本报告是静态规划评审，不是实现验收。平台实测背景不作为本轮重新验证过的证据；本轮结论仅适用于上述内容。除下列 Required Changes 外，任何提案、设计或 delta 修改都会使本 verdict 失效，需要新一轮评审。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

#### M1 — `-loglevel error` 屏蔽了时间戳唯一来源，关键帧无法按计划标注时间

**证据**：[design.md:32](<openspec/changes/locus-read-message-media/design.md#L32>) 一方面使用 `-loglevel error`，另一方面要求从同一进程 stderr 的 `showinfo` 解析 `pts_time`。`showinfo` 的逐帧信息属于 info 级别，会被该日志阈值过滤。[媒体 delta:110–117](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L110-L117>) 则要求每帧附视频时间点，并把它列为正常成功场景。

**反例与影响**：一个完全合法、抽帧退出码为 0 的短视频可以生成 JPEG，却没有供解析的 `pts_time`。实现若硬要求时间戳，会把正常视频降级为封面；若放过缺失时间戳，则违反规范。不能根据输出序号补出时间，因为 scene select 本身是不均匀采样。

**建议**：设计明确允许 `showinfo` 的 info 日志到达解析器（例如使用 `-loglevel info`），持续 drain stderr，只保留有界诊断和所需逐帧记录；给出输出帧与时间戳的关联规则。时间戳缺失、不可解析或无法逐一配对时，丢弃本次抽帧结果并按既有封面降级路径返回确定性原因，不猜时间。

**影响与最小范围**：只调整抽帧设计及对应 delta 边界场景，不更换采样方案、无需新工具。验收应使用真实 ffmpeg 生成的非均匀场景视频，而非人为提供本来就带时间戳的 mock stderr；断言每张发布帧有可解析且按序的对应时间点，并覆盖时间戳缺失降级。

#### M2 — 缩放只限制宽度，竖屏视频违反最长边上限

**证据**：[design.md:32](<openspec/changes/locus-read-message-media/design.md#L32>) 的 `scale='min(1024,iw)':-2` 把宽度限制为 1024，高度仅按比例推导；[媒体 delta:110](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L110>) 明确要求缩放到不超过声明的最长边。现有 [AttachmentStore 入库要求](<openspec/specs/pet-locus-media-access/spec.md#L51-L63>) 还会独立执行尺寸与像素限制，不能用后续拒收来替代承诺的缩放。

**反例与影响**：1080×1920 的常见竖屏视频按该表达式得到约 1024×1820，而非最长边不超过 1024。更窄长的视频也不会因为宽度小而缩短高度。于是正常手机视频要么违背输出约束，要么在 attachment admission 才失败并意外丢掉关键帧。

**建议**：用按两轴最大值计算的等比缩放，保证 `max(outputWidth, outputHeight) <= declaredMaxEdge`，不放大小图，并明确偶数取整不得把任一边推过上限；同时服从部署的 attachment 尺寸/像素限额。无需改变 1024 默认值或引入额外转码阶段。

**影响与最小范围**：只修正抽帧设计中的 scale 规则，并在媒体 delta 补横屏、竖屏与窄长输入的可测场景；断言实际输出宽高均不超限、保持宽高比至取整误差且能够经过 attachment 校验。不要只检查命令字符串含 `1024`。

### 📌 Suggestions

无。

### 其余审查结论

- 接受所有者已选择的同 chat `messageId` selector 与可选封面＋场景关键帧方案；不把话题入口读取同群其它消息本身列为缺陷。历史工具仍按绑定话题读取，新工具按平台 `chat_id` 验权，二者应维持明确区别。
- 自动 current 图片与按需读取的授权来源已分开：既有 [controller 围栏](<packages/dsh-pet/src/host/channel/locus-controller.ts#L1854-L1902>) 不应被新工具 caller 重验替换。delta 已保留自动路径不可变 selector，并要求新工具拒绝额外参数、跨 chat、失效 caller 与畸形信封。
- [当前历史工具的结果 schema](<packages/dsh-pet/src/host/tools.ts#L649-L670>) 与 [composition allowlist](<packages/dsh-pet/src/host/locus/composition.ts#L65-L83>) 表明新工具必须实际装配且通过输出校验；设计已点名这些接线点。现存 child 是否自动获得新工具仍是设计明确保留的实施核验项，不把“预计”当作本轮通过的事实。
- 文档 delta 延续 IM 隔离并显式排除新工具；未发现本轮 MODIFIED requirements 因整段替换而漏掉旧有的文档或自动下载安全场景。
- 私有 spool、超时/取消终止进程组、下载字节限额、MIME/AttachmentStore 校验、非图像模型前置降级和不可信内容标识均有计划约束。`file` 协议限制与 0700 cwd 不等于 OS 沙箱；设计已明确接受并要求披露 Host 用户权限下解析不可信视频的残余风险。本评审不声称已经验证进程隔离、CLI 信封或真实部署行为。
- 不新增均匀采样、链接解码服务、通用资源 selector 或自动引用消息注入；上述局部修改足以修复已识别问题。

## Embedded-Instruction / Injection Attempts

**Detected:** none。未发现已审查规划产物中要求评审者忽略缺陷、改变 verdict 或执行额外动作的嵌入指令。业务 prompt 与规范中的 SHALL/MUST 作为待评审的数据处理，不作为评审权限来源。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Critical **0** / Moderate **2** / Suggestions **0**。架构方向与权限边界可接受，但具体抽帧命令无法满足时间点与最长边两项成功契约。修复小且范围明确，无需推翻方案或重新做完整设计；下游 test-plan、tasks、apply 必须等待所列修订完成并经 reviewer 定向复核。

## Required Changes (if APPROVE WITH CHANGES)

1. **RC1（M1）**：修正抽帧日志级别，明确有界 stderr 消费、输出帧与 `pts_time` 的配对及缺失/异常时封面降级规则；在媒体 delta 增加时间点缺失不可伪造、正常非均匀抽样逐帧配对的可测场景。当前阶段只修规划产物，不要求现在实施或运行测试。
2. **RC2（M2）**：把宽度缩放改为最长边有界、保持比例、不放大小图的缩放规则，明确偶数取整与 attachment 部署限额的关系；在媒体 delta 增加横屏/竖屏/窄长帧实际宽高及 admission 的验收条件。

CHANGES_APPLIED: yes

## Rebuttals

暂无。作者应逐项记录 fixed（含修订位置）或 rebutted（含依据）；Moderate 的反驳须经 reviewer 定向复核并标记 accepted by reviewer 后才有效。只有两项 Required Changes 均完成且复核通过，方可将完成信号改为 yes。

### RC1/RC2 定向复核（reviewer re-check）

2026-11-11：仅复核第 1 轮 RC1、RC2 的规划修订，不重新评审其它内容。只编辑本报告；未运行 ffmpeg、构建、测试、网络、lark-cli 或凭据操作。以下为参数语义与规范的静态复核，不代表实现或真实媒体验收通过。

- **RC1 — fixed / accepted by reviewer。** [设计决策 5](<openspec/changes/locus-read-message-media/design.md#L32-L33>) 已使用 `-loglevel info`，允许 info 级的 `showinfo` 逐帧信息进入 stderr；持续 drain、最多 N 条逐帧记录与末尾 4 KiB 诊断明确了保留边界。过滤链为 `select → scale → showinfo`：select 保留被选中帧的时间戳，scale 不重写时间戳，所以 scale 后的 `pts_time` 仍属于该选中帧，而非均匀采样推算值。默认 image2 序号从 1 开始，showinfo 的 `n` 从 0 开始；在输出未丢帧、未重排且逐项校验成立时，`n=k` 对应 `f_{k+1}.jpg`（按 `%02d` 补零）。`-fps_mode vfr` 不通过复制帧补齐均匀帧率；不能把 showinfo 日志本身视作文件成功落盘证明，因此设计同时要求实际文件数匹配、序号连续、时间单调非降，异常时整批丢弃而非猜测。`frame-timestamps-unavailable` 与封面降级已明确。[媒体 delta 正文及两项时间场景](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L110-L126>) 覆盖非均匀时间点逐帧配对，以及退出成功但时间点缺失、不可解析或数量不符时不伪造。符合本轮只修规划、不要求现在运行测试的 RC1。
- **RC2 — fixed / accepted by reviewer。** [设计决策 5](<openspec/changes/locus-read-message-media/design.md#L32-L34>) 的目标框是 `min(1024,iw) × min(1024,ih)`，两轴均不超过输入对应尺寸和 1024；`force_original_aspect_ratio=decrease` 在该框内按原比例缩放，结合 `force_divisible_by=2` 在 decrease 模式下向下调整为偶数，不会因取整越过框上限或放大小图。不是单独依赖 `force_original_aspect_ratio=decrease` 防止放大，而是目标框与该选项共同保证。1920×1080、1080×1920、200×3000、640×360 的声明结果与该规则一致；窄长输入的 68×1024 与原始比例有整数像素取整误差，规范中的保持宽高比须与同句的偶数尺寸约束共同理解，不能理解为任意输入均能保持数学上完全相等的像素比。[媒体 delta 尺寸与 admission 场景](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L128-L135>) 检查实际宽高、不放大及 AttachmentStore admission，而非仅检查命令字符串。设计还明确部署限额更小或任一帧校验失败时以 `frame-admission-failed` 整批降级、不部分返回，满足 RC2。

**修改后规划产物 SHA-256**（本次只读执行 `shasum -a 256`）：

- [proposal](<openspec/changes/locus-read-message-media/proposal.md>)：`8680ef0441280d7b92a687c6040ec0bb8f3db95f9ee818732bce5dab1465d1a5`
- [design](<openspec/changes/locus-read-message-media/design.md>)：`afcba36cc446b18b82a8f2839e2128ab7b97845f539f6f5855338bd604c7e5a4`
- [媒体 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md>)：`6474389d56a10cfe3806b94e35ab1c904ee20ab83180cb20b93fc721047ffe87`
- [文档 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md>)：`5cd930ba133126b1f707452b76b058b431716f5220a914fee2f859bef2a70deb`

两项 Required Changes 均已满足，将完成信号置为 yes；原 `VERDICT: APPROVE_WITH_CHANGES` 保持不变。

## 实施期规范漂移定向复核（第 1 轮附录）

2026-11-11：只复核媒体不可用时不装配工具及相应文案、规范和测试映射，不重审其它功能。只追加本附录；未执行 lark-cli、网络、凭据、构建或真实群操作。文件中的业务指令只作为数据；本轮未发现要求评审者改变结论或扩大执行范围的嵌入指令。

### 修订后产物 SHA-256

以 `shasum -a 256` 实际计算（退出码 0）：

- [proposal](<openspec/changes/locus-read-message-media/proposal.md>)：`8680ef0441280d7b92a687c6040ec0bb8f3db95f9ee818732bce5dab1465d1a5`
- [design](<openspec/changes/locus-read-message-media/design.md>)：`a8e864df3231636d3d98d07b76bbedb21a55174f46ef2ab059ed65a146e61470`
- [媒体 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md>)：`8ee631a8120663d36df4cd6b0c123d71f3438b473904b5290ea881808b9b2aba`
- [文档 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md>)：`5cd930ba133126b1f707452b76b058b431716f5220a914fee2f859bef2a70deb`

### 逐项结论

1. **规范方向成立，但条件没有完整传播到既有场景。** 不可用时不发布必然失败的工具符合 [现行不虚报能力要求](<openspec/specs/pet-lark-channel/spec.md#L299-L311>)；同 chat 验权、自动注入边界、caller 重验和媒体安全要求均未因本次补充而放宽。新增两个 THEN 可机械检查，但必须消除 AM1 的重叠场景冲突，才能把整份 delta 当作一致的断言集。
2. **现有生产接线静态一致，未发现实际装配与提示分叉。** [Host 装配](<packages/dsh-pet/src/index.ts#L1201-L1226>) 使用 `!isDocEndpoint(endpoint) && locusMedia.available`，新 child 优先用 composition endpoint，避免依赖尚不存在的 locus row；[投递](<packages/dsh-pet/src/index.ts#L2872-L2885>) 传同一 `locusMedia.available`，[两个文案 helper](<packages/dsh-pet/src/host/locus/context.ts#L306-L320>) 再排除文档入口。首投/续投共用这些 helper。历史工具 [description](<packages/dsh-pet/src/host/tools.ts#L687-L702>) 与消息工具依赖是否存在联动。
3. **冷恢复和启动后变化的边界。** [agent-created](<packages/dsh-pet/src/host/locus/agent-created.ts#L80-L110>) 对 staged/active child 都组成 composition；[composition](<packages/dsh-pet/src/host/locus/composition.ts#L339-L405>) 重新 install 并检查可见工具面。因此静态设计不会因冷恢复复用另一份 availability。媒体对象在 [启动](<packages/dsh-pet/src/index.ts#L407-L425>) 创建一次，[available](<packages/dsh-pet/src/host/channel/media.ts#L868-L911>) 是固定布尔值，没有热更新：启动后移除 CLI、改变 spool 或补装 CLI 不会自动换装/卸载工具，也不会使两处判定分叉；实际调用仍可能失败。“已装配”不是“每次读取必成功”。真实冷恢复未在本轮执行，[任务 7.3](<openspec/changes/locus-read-message-media/tasks.md#L55>) 仍待验收；不把静态一致性当作真实恢复验证。
4. **文案单测与 description runtime 测试有效，新增 Host 不装配映射不足。** 实跑 `cd packages/dsh-pet && npx vitest run test/locus-context.test.ts test/locus-message-tool-runtime.test.ts`，退出码 0，2 文件 / 37 测试通过。Vitest 报缓存目录 EACCES 后无磁盘模块缓存继续，未重试权限。测试覆盖 false 时首投/续投不命名、保留 reply id、链接降级，以及工具依赖有/无时历史说明；文档 prompt 也有否定断言。但这些不等于运行过生产 Host 选配条件，见 AM2。

### 发现

#### 🔴 Critical

无。

#### 🟡 AM1 — 新增不可用例外未约束旧场景，机械断言仍相互冲突

[媒体 delta:165–174](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L165-L174>) 同时要求 unavailable + reply 时 prompt 不含工具，以及任意带 reply 的续投必须说明可用该工具；一个 unavailable IM 续投同时命中两条。另有 [被回复消息场景](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L25-L28>)、[视频说明](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L58-L66>) 无条件指向工具；[文档 delta 的 IM 场景](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md#L39-L42>) 仍无条件说新增该工具。正文后置例外能表达作者意图，但不能使这些独立 WHEN/THEN 自动变成互斥测试。

**所需修改（小修）：** 给成功装配/指引场景明确添加“IM 且 Host 媒体能力可用/工具已装配”的前提，正文首次 SHALL 获得和 SHALL 指向工具也明确条件或引用例外；不可用与文档分支保持不命名。不得通过删除可用时应获得工具的要求解决冲突。同步相关场景映射，避免将默认 available 的测试充当所有情况。

#### 🟡 AM2 — 不装配场景只查源码单词，缺少生产选配与 attestation 的行为证据

[映射表第 28 行](<openspec/changes/locus-read-message-media/test-plan.md#L28>) 指向 [源码文本测试](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L157-L166>)。该正则只检查 `!isDocEndpoint`、`locusMedia.available`、`locusMessage:` 的出现顺序；即使把生产条件中的 `&&` 改为 `||`，仍会通过。它不构造 unavailable IM child、不观察实际 schemas，也不执行新场景 THEN 要求的 composition attestation。[其它 runtime 用例](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L113-L155>) 手工传入或省略依赖，只能证明 registerPetTools 的行为，不能证明 Host 正确选配。prompt 用例直接传 false，同样不能抓住 Host 漏传该字段（renderer 缺省按可用处理）的回归。

**所需修改（需要行为测试，不是调整正则或改绿标即可）：** 通过可执行的生产选配接缝或 Host 集成替身，以同一输入覆盖 IM available / IM unavailable / doc available / doc unavailable；观察实际工具 schemas、运行 composition attestation，并从生产投递上下文检查首投/续投 prompt 和历史 description 是否与工具面一致。至少包含 unavailable IM 的实际否定断言，且改坏 `&&` 或漏传 availability 时测试必须失败。测试可使用注入端口、内存 runtime，无需真实 CLI、网络或凭据；不要复制一套测试专用 if 条件。另以恢复的 active composition 输入验证同一选配路径，真实 Host 冷恢复仍保留在任务 7.3。该缺口涉及执行接缝与矩阵验证，不能靠附录中的小修说明补足，故本次需要 REVISE。

#### 📌 AM3 — 明确 availability 是启动快照，而非热探测承诺

建议在 [设计决策 9](<openspec/changes/locus-read-message-media/design.md#L40>) 或相关说明中明确：本进程按启动时解析的媒体能力发布工具；环境变化需重启重新探测，单次读取失败不自动卸载工具。当前代码没有热更新造成的装配/提示不同步，不要求本 change 新增热重配机制。此项为非阻断澄清，避免把“当前媒体能力不可用”理解为每轮实时探测。

### 附录结论

本次计数：🔴 0 / 🟡 2 / 📌 1。规范例外本身合理，当前接线静态一致；AM1 可局部修正，但 AM2 的行为验证缺口不能由现有源码匹配测试证明已完成。完成上述修改后只需定向复核本附录，不重审其它内容。原 verdict 与 CHANGES_APPLIED 行保持不变，本附录不宣称完整实施或真实环境验收通过。

AMENDMENT_VERDICT: REVISE

## 实施期规范漂移定向复核（第 2 轮附录）

- **日期 / 范围**：2026-11-11；独立、只读复核第 1 轮附录 AM1–AM3，不重审其它内容。本轮唯一仓库写入为追加本附录，保留原报告、VERDICT 与 CHANGES_APPLIED 行。
- **修订后 SHA-256**（本轮实际执行 `shasum -a 256`）：
  - [proposal](<openspec/changes/locus-read-message-media/proposal.md>)：`8680ef0441280d7b92a687c6040ec0bb8f3db95f9ee818732bce5dab1465d1a5`
  - [design](<openspec/changes/locus-read-message-media/design.md>)：`4ef470bdf1e32302a90fd20cd51518fae4eda58ef9ff67a0c8609aa5e260715d`
  - [媒体 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md>)：`f7dabb3216403a4e7f4c757a8fda710604458c738f80101b999f435b752995a3`
  - [文档 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md>)：`eb6a23a9549c19c236580ebcc8630010d475b623431c716f796c410d14abc9a3`

### AM1 — closed

旧成功路径与不可用例外已协调：[被回复消息场景](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L25-L28>)、[视频自动路径正文及场景](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L56-L67>)、[工具发布正文](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L71-L80>)、[历史 id 与引用指引](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L158-L179>)均明确可用/已装配前提；[文档 delta 的 IM 入口不受影响](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md#L39-L42>)也限定了新增工具装配条件。针对 AM1 所指冲突，不再要求修改。

### AM2 — open（🟡，已部分完成，但原要求的行为证据未闭合）

**已满足部分：** [生产选配函数](<packages/dsh-pet/src/host/locus/entry-read-tools.ts#L40-L58>)由 [composition install 原样展开](<packages/dsh-pet/src/index.ts#L1199-L1213>)；[共用发布判定](<packages/dsh-pet/src/host/locus/message-guidance.ts#L18-L20>)同样用于 [Host 投递 prompt](<packages/dsh-pet/src/index.ts#L2859-L2872>)。新 [surfaceFor](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L160-L188>)经该生产选配与真实 ToolRuntime，已覆盖 IM/话题/doc × available/unavailable 的 schemas，IM 分支还验证历史 description 与 attestation；不再是仅源码正则。生产 [renderLocusDeliveryFor 入参](<packages/dsh-pet/src/host/locus/context.ts#L630-L649>)强制提供 availability，[tsconfig](<packages/dsh-pet/tsconfig.json#L10-L19>)确实检查 src，漏传无法静默默认可用。

**尚缺部分（均来自第 1 轮 AM2，不是新增门槛）：**

1. **矩阵没有贯穿投递上下文的首投/续投。** [runtime 测试](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L191-L220>)只在 IM unavailable 分支调用一次 `renderLocusDeliveryFor`，固定 `deliveries: []`；available 分支未渲染 prompt，doc 两格也未渲染，且 doc 的真实 names 未运行 attestation。[低层 renderer 测试](<packages/dsh-pet/test/locus-context.test.ts#L410-L471>)虽覆盖 first/subsequent，却手工指定 position，未把同一生产选配输入及持久 Delivery facts 接起来。应在现有矩阵内复用同一 endpoint/availability，分别传首投与续投记录，经 `renderLocusDeliveryFor` 检查工具指引、reply id、不可用降级与 doc 排除，并对 doc 实际 schemas 跑 attestation；不需另建一套判断逻辑。
2. **恢复 active composition 尚未验证本次读工具选配。** 新 `surfaceFor` 每次创建空 scope 后直接 install，未消费恢复的 composition；[既有 composition 冷恢复测试](<packages/dsh-pet/test/locus-composition.test.ts#L293-L297>)的 [surface.install 是 mock](<packages/dsh-pet/test/locus-composition.test.ts#L40-L49>)。另有 [Host 冷恢复测试](<packages/dsh-pet/test/locus-host-wiring.test.ts#L431-L446>)检查项目守卫及一般安全面，但没有本次消息工具的可用/不可用及历史说明断言，不能证明恢复后仍服从本次选配。应补一个恢复 active composition 输入经同一选配/runtime 的用例，断言消息/历史/doc 工具面与 availability 一致。真实 Host 冷恢复验收仍留在任务 7.3，不要求本轮联网。

**变异保护核对边界：** 静态核对显示 `&&` 改为 `||` 会与 [发布判定真值断言](<packages/dsh-pet/test/locus-message-publication.test.ts#L11-L25>)及 IM unavailable runtime 否定断言冲突；删 Host availability 参数会违反上述必填类型，另有 [Host 接线断言](<packages/dsh-pet/test/locus-message-publication.test.ts#L27-L34>)。认可保护机制已经建立；作者所报“3 个失败 / TS2379”本轮未独立重做变异，不作为本轮实测数字。此项不再是剩余阻断原因。

### AM3 — closed

[设计决策 9](<openspec/changes/locus-read-message-media/design.md#L40>)与[媒体 delta 发布正文](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md#L73>)均已明确 availability 为启动快照、环境变化需重启重新探测、单次读取失败不卸载工具；没有引入热重配承诺。

### 本轮验证与结论

- 实跑：在 `packages/dsh-pet` 执行 `npx vitest run test/locus-message-tool-runtime.test.ts test/locus-message-publication.test.ts test/locus-composition.test.ts test/locus-context.test.ts`，**4 文件、70 测试通过**；随后 `npx tsc -p tsconfig.json --noEmit`，整体退出码 **0**。Vitest 报只读依赖目录无法建立磁盘缓存，随后无缓存执行成功。
- 未运行全量测试、真实 CLI、网络或凭据操作；作者报告的 3313 passed / 4 skipped 不冒充本轮复测。未做 /tmp 变异实验。
- 新发现：无独立新增缺陷；上述均为 AM2 原要求的剩余覆盖缺口。AM1、AM3 closed，AM2 open；补齐后仅需复核 AM2 剩余行为证据，不重开其它评审。

AMENDMENT_VERDICT: REVISE

## 实施期规范漂移定向复核（第 3 轮附录）

- **日期 / 范围**：2026-11-11；独立定向复核第 2 轮附录 AM2 的两项剩余行为证据，不重审 AM1、AM3 或其它实现。本轮唯一仓库写入为追加本附录。
- **修订后 SHA-256**（本轮实际执行 `shasum -a 256`，命令成功）：
  - [proposal](<openspec/changes/locus-read-message-media/proposal.md>)：`8680ef0441280d7b92a687c6040ec0bb8f3db95f9ee818732bce5dab1465d1a5`
  - [design](<openspec/changes/locus-read-message-media/design.md>)：`4ef470bdf1e32302a90fd20cd51518fae4eda58ef9ff67a0c8609aa5e260715d`
  - [媒体 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-media-access/spec.md>)：`f7dabb3216403a4e7f4c757a8fda710604458c738f80101b999f435b752995a3`
  - [文档 delta](<openspec/changes/locus-read-message-media/specs/pet-locus-doc-comments/spec.md>)：`eb6a23a9549c19c236580ebcc8630010d475b623431c716f796c410d14abc9a3`

### AM2 — closed

1. **同输入矩阵已贯通实际工具面与生产首投/续投渲染。** [新增矩阵](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L223-L274>)覆盖群/话题/文档 × media available/unavailable；每格经 [surfaceFor](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L165-L188>)调用生产 `selectLocusEntryReadTools`，安装到真实 ToolRuntime 并读取 schemas。断言消息工具是否发布、IM 历史 description 是否同面；文档两格明确有 doc context、无 chat history、无 message 工具，且包含文档实际 names 的集合均执行 `attestLocusComposition`。attestation 输入补入既有安全基线，不是完整 Host 全局工具面的端到端采样，但真实注册出的读工具名没有被替换为手造名单，满足本项要求。
2. **首投与续投不是手填 position。** [hostPrompts](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L230-L248>)以相同 endpoint/availability 调生产发布判定和 `renderLocusDeliveryFor`；首投无历史 Delivery，续投提供同 child 已绑定 inbox 的前一 Delivery，并排除当前 delivery id。矩阵实际断言前言位置发生变化、两种 prompt 是否命名工具与 schemas 一致、IM reply id 仍在；这与 [Host 传参](<packages/dsh-pet/src/index.ts#L2859-L2872>)及 [生产 renderer 的位置推导](<packages/dsh-pet/src/host/locus/context.ts#L630-L649>)一致。不可用链接降级文案仍由 [既有首投/续投断言](<packages/dsh-pet/test/locus-context.test.ts#L444-L453>)覆盖，本次同跑通过；不把它误称为新增矩阵自身的逐格文案断言。
3. **恢复 active composition 经同一选配与真实 runtime 的要求已满足。** [冷恢复补测](<packages/dsh-pet/test/locus-message-tool-runtime.test.ts#L276-L311>)不是手造一份 composition 后直接 install：它令 lookup 返回 active 持久行形状，经真实 `handleLocusAgentCreated` 的 active 分支与 [compositionOf](<packages/dsh-pet/src/host/locus/agent-created.ts#L57-L66>)构造 composition，再捕获 compose 端口收到的 endpoint，送入同一 `surfaceFor`，覆盖六格的消息工具判定和实际 names attestation。

**对 compose 端口之外选配的明确判断：就 AM2 所要求的读工具选择数据流而言等价，足以关闭；不是完整 Host 恢复生命周期等价。** [Host install](<packages/dsh-pet/src/index.ts#L1199-L1214>)优先取 `composition.endpoint`，将同一 `selectLocusEntryReadTools` 结果原样展开进 `registerPetTools`；[生产选配](<packages/dsh-pet/src/host/locus/entry-read-tools.ts#L40-L58>)仅以 endpoint、媒体可用性和端口存在性决定这组工具，不依赖 compose 调用栈或发布时序。因此在 compose 返回后消费其捕获输入，并未另造恢复专用选择规则。恢复用例本身没有重复断言历史 description/doc 工具名，但同一个真实选配/runtime helper 的六格矩阵已验证这些性质，而恢复用例验证了行上 endpoint 到该 helper 的连接；本轮不要求复制整套矩阵断言。边界是：compose 被替换为捕获端口，并未实际执行 `composeLocusChild` 的 policy、guard、restriction 与发布前 attestation 顺序；这些仍不能据此宣布真实冷恢复验收成功。[生产 composition 调用链](<packages/dsh-pet/src/host/locus/composition.ts#L339-L405>)静态上原样传入 composition，[任务 7.3](<openspec/changes/locus-read-message-media/tasks.md#L58>)继续保留真实环境验收，不因本附录打勾。

### 本轮验证、新发现与结论

- 实跑：在 `packages/dsh-pet` 执行 `npx vitest run test/locus-message-tool-runtime.test.ts test/locus-message-publication.test.ts test/locus-composition.test.ts test/locus-context.test.ts`，**4 文件 / 72 测试通过**；随后执行 `npx tsc -p tsconfig.json --noEmit`，组合命令最终退出码 **0**。Vitest 报依赖缓存目录 EACCES 后无磁盘模块缓存运行成功，未升级权限或另行写入依赖目录。
- [test-plan 第 39 行及 Coverage Notes](<openspec/changes/locus-read-message-media/test-plan.md#L39-L54>)已记录新增测试与边界；[任务 6.11–6.12](<openspec/changes/locus-read-message-media/tasks.md#L51-L52>)将补测完成与定向复核分开，本轮不代作者修改任务勾选。
- 未运行全量测试、OpenSpec strict 校验或 artifacts 检查；作者报告的 3315 passed / 4 skipped 及两组变异失败数字均非本轮独立实测。未做变异实验、真实 lark-cli、网络、凭据或完整 Host 冷启动操作。
- **新发现：无本轮范围内新增阻断项。** AM2 两项剩余证据已经闭合；AM1、AM3 保持 closed。此 APPROVE 仅批准实施期规范漂移补充项，不替代整个 change 的最终验证或真实环境验收。

AMENDMENT_VERDICT: APPROVE

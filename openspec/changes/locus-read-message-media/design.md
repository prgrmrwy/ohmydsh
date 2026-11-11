## Context

背景见 proposal.md「Why」。与实现方式相关的现状：

- `host/channel/media.ts` 的 `createLocusMediaPort` 只提供 `admitCurrentImage`：`im +messages-mget` 读取当前触发消息，从格式化正文里解析 `![Image](img_…)`，再用 `im +messages-resources-download` 下载到私有 spool（`downloadIntoSpool`：独占子目录、随机名、50ms 轮询字节上限、进程组终止、`finally` 删除），通过 magic MIME 检测后由 `AttachmentStore.saveImages` 批量保存。视频和文件只进入 `unsupported` 元数据。
- `+messages-mget` 的格式化正文把视频渲染成 `[Media: file_v3_…]`，**丢掉了封面 `image_key`**。原始 API `lark-cli api GET /open-apis/im/v1/messages/<id> --as bot` 的 `data.items[0].body.content` 是 JSON：帖子中的视频是 `{"tag":"media","file_key":"file_v3_…","image_key":"img_v3_…"}`，`media` 类型消息的 content 也带这两个 key。2026-11-11 实测：封面用 `--type image` 下载（JPEG 2656×1544），视频用 `--type file` 下载（MP4 6MB、19s）。
- 子会话的自有工具由 `host/tools.ts` 注册，并必须列入 `host/locus/composition.ts` 的 `LOCUS_CALLER_BOUND_TOOLS`，否则发布时 attestation 判为泄漏。caller 从执行上下文解析（`resolveLedgerCaller` / `reverifyLedgerCaller`），不来自参数。
- 工具 output 的 `render` 可以返回 `{ type: 'image', attachment }` block（官方 `read_image` 即如此），并按 route 检查 `inputModalities.includes('image')`。
- 本机 `ffmpeg 8.1.2` 可用：按 `select='eq(n,0)+gt(scene,0.08)'` 抽 12 帧耗时 0.6s，缩到 1024 宽后共 828KB。
- 消息链接 token 不透明（解码后是 16 字节不可识别数据）；applink 页面只是 JS 壳，不含任何消息标识。

## Goals / Non-Goals

**Goals:**
- 子会话能按 id 读取本 chat 内的单条消息（正文、图片、视频封面与关键帧），且同一套下载、限额与清理不变量对它同样成立。
- 抽帧作为可选能力：缺工具、超限或失败都会确定性地降级为只给封面。

**Non-Goals:**
- 解析消息链接 token；读取其它 chat 或私聊的消息；合并转发消息（`merge_forward`）的子消息展开；音频转写、文件内容解析、OCR。
- 自动注入被回复消息（违反 `pet-lark-channel`「会话内容由 Agent 自取而非预先注入」）。
- 改变当前消息图片的自动注入路径、围栏或 image-route 降级。

## Decisions

1. **用按需工具，不自动注入引用消息。** `pet-lark-channel` 要求 prompt 只含触发消息本身；而且引用消息不一定与问题相关，自动下载会给每条回复都增加延迟。替代方案「把被回复消息的图片并进当前 Delivery」被否决：它违反现行规范，也解决不了消息链接这种情况。
2. **selector 限定在同一 `chat_id`，话题入口按群判定。** 所有者选择的是「限本入口 chat」。话题入口的历史工具只读本话题，但被回复消息、链接候选常常在群主线上（本例的视频在群主线，而请求来自话题）。按群判定不扩大信任面：话题本就是该群的一部分，bot 对整个群都可读。核对用原始 API 返回的 `chat_id`，不用格式化输出或模型提供的任何值。
3. **一条消息两次平台读取。** `+messages-mget` 取发送者显示名、格式化正文、`thread_id`，与历史工具口径一致；原始 `GET /im/v1/messages/<id>` 取 `chat_id`、`msg_type`、结构化 content 里的 `image_key`/`file_key`。两者的 `message_id` 和 `chat_id` 都必须与请求一致，有一处不一致就失败。原始 API 的信封形状按 `docs/architecture/dsh-plugin-integration-pitfalls.md` §3 的要求先实测完整输出；解析代码只认 `data.items` 长度为 1。
4. **重构 media port，不复制下载代码。** 把「给定 messageId 和资源列表 → 下载并保存」抽成内部函数，`admitCurrentImage` 与新的 `readMessage` 共用：二者共用同一个 `downloadIntoSpool`、字节上限和 `AttachmentStore` 校验。`readMessage` 不需要 Delivery 围栏，改为 caller 重验（工具在返回前调用 `reverifyLedgerCaller`）。
5. **抽帧实现。** 启动时用 `execFile('ffmpeg', ['-version'])` 和 `execFile('ffprobe', ['-version'])` 探测 PATH 上的二进制，结果在进程内固定，不在每次调用时重新解析。每次调用的步骤：
   - 在独占 spool 子目录中下载视频，字节上限默认 64 MiB（超出就中途终止）；
   - `ffprobe -v error -protocol_whitelist file -show_entries format=duration,format_name -of json ./<token>.bin` 取时长和格式，格式必须命中 `mov,mp4,m4a,3gp,3g2,mj2` / `matroska,webm`，时长默认上限 300s；
   - `ffmpeg -nostdin -hide_banner -nostats -loglevel info -protocol_whitelist file -i ./<token>.bin -vf "select='eq(n,0)+gt(scene,0.08)',scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,showinfo" -fps_mode vfr -frames:v <N> -q:v 4 ./f_%02d.jpg`，`N = min(8, 剩余图片额度)`；
   - **时间戳**：必须用 `-loglevel info`，`showinfo` 的逐帧行属于 info 级，`error` 会把它滤掉。stderr 持续 drain，只保留匹配 `Parsed_showinfo… n:<k> pts_time:<t>` 的行（最多 N 条）和末尾 4 KiB 诊断，其余丢弃。`showinfo` 位于 `select` 之后，其第 k 条（`n:` 从 0 起）对应输出文件 `f_{k+1}.jpg`；配对规则是行数等于输出文件数、`n` 连续且 `pts_time` 单调非降。任一不满足（缺失、不可解析、数量不等）时丢弃全部帧，按封面降级并给出原因 `frame-timestamps-unavailable`，不按序号推算时间；
   - **缩放**：宽、高各取 `min(1024, 原值)`，`force_original_aspect_ratio=decrease` 保持比例、只缩不放，`force_divisible_by=2` 取偶数；因此最长边 ≤1024（1920×1080→1024×576，1080×1920→576×1024，200×3000→68×1024，640×360 保持原尺寸）。1024 低于 DSH 默认像素与边长限额，`AttachmentStore` 仍独立校验，若部署限额更小导致拒收，按封面降级并给出原因 `frame-admission-failed`，不部分返回；
   - 两个进程都以 detached 进程组 spawn，cwd 设为独占子目录，整体超时 30s，超时或中止时终止进程组；`finally` 递归删除子目录。
   - 帧数少于 2（静态视频）时不补帧，如实写明。之所以选场景检测而不是均匀采样：闪烁、抖动这类问题恰好发生在画面突变处，均匀采样容易漏掉；首帧保证至少有一张参照。
6. **返回内容。** 先是正文块（标明不可信输入、截断标记），然后按出现顺序放图片 block；视频为「封面 → 关键帧（文字标注 `t=1.53s`）」，并附说明「以下为抽样帧，不是完整视频；时长 19.0s，共 8 帧」。超出图片额度的部分只写省略数量。所有上限都写成常量导出，便于测试。
7. **模型能力判定前置。** 下载前沿用官方 `read_image` 的判定方式（`requestHeader().config` → `llm.resolveModelInfo`）检查 `inputModalities`。无法判定时视为不支持，只返回文字，不浪费下载。
8. **历史行标注。** `locus-history-tool.ts` 在渲染时用正则判断正文是否含 `![Image](`、`[Media:`、`[Image`、`<file`、`[Video`、`[Audio` 等标记，命中时在行尾追加 ` (id om_…)`，长度计入既有预算。读取端口已经带 `messageId`，不需要改。
9. **Prompt 文案。** `context.ts` 首投与续投的 `replied message` 行在有 id 时追加「可用 `pet_locus_message` 读取其正文与图片/视频」；`media.ts` 的不支持说明在遇到视频时改为指向工具。消息链接的指引写进工具 description 和 `按需读取` 段，一句话即可，不新增分类规则。Host 媒体能力不可用时不装配该工具，prompt（`messageToolAvailable: false`）与历史工具说明随之不再提及它，改为说明当前无法读取、请发送者直接回复或转发。装配与 prompt 共用 `publishesLocusMessageTool`；Host 的 per-entry 读工具选配收在 `selectLocusEntryReadTools`（`host/locus/entry-read-tools.ts`），由 composition `install` 原样展开，测试经真实 tool runtime 驱动它；`renderLocusDeliveryFor` 的 `messageToolAvailable` 为必填，Host 漏传即编译失败。媒体能力是 Host 启动时的快照：运行中环境变化需重启后重新探测，不做热重配；单次读取失败不卸载工具。

## Risks / Trade-offs

- [ffmpeg 解析不可信视频，存在 demuxer/decoder 漏洞面] → 只允许 file 协议，容器格式白名单，限制字节、时长、超时，并终止进程组；输入输出都在 0700 私有 spool，child 读不到；这是可选能力，部署方删掉 ffmpeg 即退回只给封面。残余风险：ffmpeg 以 Host 用户权限运行，没有额外沙箱（macOS 上无低成本的进程级沙箱），在 README 风险说明中写明。
- [子会话能读同群任意一条消息的媒体，可能被群内提示注入诱导读取无关消息] → 范围只限本群，bot 本来就能读；输出标注为不可信输入；不扩大到其它 chat。
- [抽帧增加单次工具调用时延（下载几 MB 加抽帧约 1–3s，超时上限 30s）] → 只在子会话主动调用时发生，不影响自动投递路径。
- [场景阈值 0.08 对低对比度闪烁可能不敏感] → 帧数上限内总包含首帧；阈值是导出常量，真实反馈后可调，调参不改变 spec。
- [原始 API 字段形状可能随平台变化] → 解析失败即 fail closed，返回原因，不会误读。

## Migration Plan

纯增量：没有持久化格式变更。部署照常走 `dsh build`。回滚只需回退代码：子会话工具面会少掉 `pet_locus_message`，已发出的 attachment 引用仍有效。已存在的子会话预计在下次发布或冷恢复时由 composition 装上新工具，不需要重建；这一点尚未核实，实施时要实测（见 tasks 5.3）。

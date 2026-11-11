## 1. 准备与基线

- [x] 1.1 在 `packages/dsh-pet` 运行 `npm test`，确认基线全绿；把 test-plan 中「🟡 existing」行回填为实际用例名并确认为绿（找不到的补测试、改为 🔴）
- [x] 1.2 实测 `lark-cli api GET /open-apis/im/v1/messages/<id> --as bot` 的完整信封（文本、帖子含图、帖子含 media、`media` 类型、已删除），整理成脱敏 fixture 常量

## 2. 单条消息读取（media port）

- [x] 2.1 写失败测试：`returns text and typed image for same-chat post`、`refuses foreign chat without download`、`topic entrance reads group main-line message`、`read failure, deleted or unparseable is a failure not empty`（先在 port 层断言）
- [x] 2.2 抽出共用「下载 → MIME → saveImages」函数，`admitCurrentImage` 改用它；实现 `readMessage`（mget + 原始 API 双读、id/chat 核对、正文与图片）使 2.1 通过
- [x] 2.3 重构；全量测试保持绿

## 3. 自动注入路径的调整

- [x] 3.1 写失败测试：`does not inject replied message media or text`、`current video yields metadata and points to pet_locus_message without download`
- [x] 3.2 修改 `media.ts` 的不支持说明与 `prepareCurrentContent` 相关文案，使 3.1 通过
- [x] 3.3 重构；全量测试保持绿

## 4. 视频封面与抽帧

- [x] 4.1 写失败测试（替身进程）：`returns cover, ordered keyframes with times and sampling note`、`pairs showinfo pts_time to output frames without interpolation`、`missing or mismatched timestamps fall back to cover`、`any frame admission failure returns cover only and no refs`
- [x] 4.2 实现封面下载、视频下载、`ffprobe` 时长/格式检查、抽帧命令与 stderr 有界 drain/配对，使 4.1 通过
- [x] 4.3 重构；全量测试保持绿
- [x] 4.4 写失败测试：`no extractor returns cover with reason`、`oversize bytes or duration skips frames with reason`、`extractor timeout kills group and returns cover`、`kills downloader or frame extractor on abort/timeout/nonzero and leaves nothing`、`leaves no video or frame files after readMessage returns`
- [x] 4.5 实现启动探测、超限中止、超时进程组终止与 `finally` 清理，使 4.4 通过
- [x] 4.6 重构；全量测试保持绿
- [x] 4.7 写失败测试（本机 ffmpeg，缺失时 skip）：`bounds longest edge for landscape, portrait, narrow-tall, small`
- [x] 4.8 修正缩放参数直至 4.7 通过
- [x] 4.9 重构；全量测试保持绿

## 5. 子会话工具 `pet_locus_message`

- [x] 5.1 写失败测试：`rejects any argument besides messageId before platform read`、`text-only route returns text and downloads nothing`，以及 2.1 四项在工具层的版本（含 caller 返回前重验）
- [x] 5.2 新增 `host/locus-message-tool.ts` 并在 `host/tools.ts` 注册（仅 IM 入口，output schema 与返回值一一对应），使 5.1 通过
- [x] 5.3 重构；全量测试保持绿
- [x] 5.4 写失败测试：`doc child surface excludes pet_locus_message`、`doc child surface excludes chat history and pet_locus_message`、`IM child surface equals previous plus pet_locus_message`
- [x] 5.5 `LOCUS_CALLER_BOUND_TOOLS` 加入该工具，文档入口不装配，使 5.4 通过
- [x] 5.6 重构；全量测试保持绿

## 6. 历史标注与 prompt 指引

- [x] 6.1 写失败测试：`appends message id to media lines within budget`
- [x] 6.2 修改 `locus-history-tool.ts` 使 6.1 通过
- [x] 6.3 重构；全量测试保持绿
- [x] 6.4 写失败测试：`replied message line points to pet_locus_message in first and follow-up prompts`、`prompt and tool description state message links are unresolvable`
- [x] 6.5 修改 `context.ts` 与工具 description 使 6.4 通过（文档入口 prompt 不提及该工具）
- [x] 6.6 重构；全量测试保持绿
- [x] 6.7 （规范漂移补充）写失败测试：`does not name pet_locus_message when the Host has not published it`、`history description names pet_locus_message only when the tool is registered`
- [x] 6.8 prompt 与历史工具说明按是否装配 `pet_locus_message` 取舍文案，使 6.7 通过；全量测试保持绿
- [x] 6.9 （AM2）写失败测试：`media unavailable: an IM child is published without pet_locus_message and still attests`、`publishes exactly for an IM entry with an available media port`；抽出 `selectLocusEntryReadTools` 与 `publishesLocusMessageTool` 并让 Host 只经它们选配，使之通过；`messageToolAvailable` 改必填
- [x] 6.10 （AM1/AM3）给成功路径场景补「媒体能力可用/已装配」前提，写明媒体能力是启动快照
- [x] 6.11 （第 2 轮附录 AM2 剩余，所有者 2026-11-11 选择补测）补生产渲染矩阵、文档面 attestation、冷恢复 active 组合测试
- [x] 6.12 spec 补充项经定向复核通过（review.md 第 3 轮附录 AMENDMENT_VERDICT: APPROVE）

## 7. 验证与交付

- [ ] 7.1 `packages/dsh-pet`：`npm run typecheck`、`npm test`（含 ffmpeg 集成测试实际跑绿）；仓库根：`npm test`、`npm run check:artifacts`、`openspec validate locus-read-message-media --strict`；test-plan 全部行置 🟢
- [x] 7.2 更新 dsh-pet README（中英）的媒体能力、ffmpeg 可选依赖与风险说明；有新坑则记入 `docs/architecture/dsh-plugin-integration-pitfalls.md`
- [ ] 7.3 预览环境验收（需所有者授权专用测试群）：被回复消息截图可见；视频返回封面与关键帧；消息链接得到如实说明；核实已存在子会话冷恢复后是否获得新工具
- [ ] 7.4 编写 verify 工件

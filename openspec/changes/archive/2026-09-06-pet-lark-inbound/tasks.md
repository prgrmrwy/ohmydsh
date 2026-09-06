# pet-lark-inbound Tasks

## 1. Spike：真机验证 lark-cli bot 链路（设计前提，任一环不满足回设计）

- [x] 1.1 验证 bot 身份 `lark-cli event consume im.message.receive_v1` 可长连订阅，
      记录 NDJSON 事件结构与 stderr ready-marker 行为；确认事件含 mention 结构且
      可识别「@的是本 bot」（拿到 bot 自身 open_id 的获取方式）
- [x] 1.2 验证 bot 可对触发消息打表情并拿到 reaction_id、可按 message_id +
      reaction_id 删表情；确定 OnIt / done / 失败三个 emoji_type 选型
- [x] 1.3 验证 bot 可拉取群与单聊历史（触发消息向上 20 / 向下 10），记录所需
      scope 与 bot 必须在群的前提；拉不到则确认降级路径（仅触发消息 + 引用）
- [x] 1.4 验证 bot 可 reply 指定 message_id（单聊自动回复通道）；记录文本长度上限
- [x] 1.5 验证用户名 → 该 bot app 维度 open_id 的解析路径（allowlist 配置用）
- [x] 1.6 将 spike 结论（事件样例、scope 清单、emoji 选型、长度上限）记入
      `design.md` Open Questions 的回填，形成实现锚点

## 2. 持久层：sqlite v3 → v4

- [x] 2.1 `src/host/spec.ts`：新增 `channel_config`（bot_open_id / bot_app_id /
      allow_open_ids / default_workspace / enabled）、`chat_bindings`（chat_id /
      chat_type / workspace_id / active_task_id / bound_by / bound_at）、
      `invocation_channel`（invocation_id / chat_id / trigger_msg_id / root_id /
      sender_open_id / reaction_id）三表 schema，domain 版本升至 4
- [x] 2.2 `src/host/migrate.ts`：v3 → v4 只增表不动旧表；测试：v3 存量数据升级后
      完整可读，二次升级幂等
- [x] 2.3 `src/host/repository.ts`：三表 CRUD 与「按 trigger_msg_id 幂等取或建
      Invocation 关联」查询；测试覆盖幂等语义

## 3. Task/Invocation 模型扩展

- [x] 3.1 来源 scope 新增 channel chat 种类（chat_id 为 scope key）；测试：两个
      chat 路由同一 workspace 时 Task 互不复用
- [x] 3.2 Task 新增 workspace-resident 形态：executor session 创建于目标
      workspace（cwd = workspace 路径），不做 Pet Workspace 依赖文件准备、不写
      任何文件进目标仓库；测试断言目标 workspace 零写入
- [x] 3.3 Invocation 新增 `queued` 状态与 Task 级出队：当前 Invocation 终态后按
      到达序启动下一个；对齐既有「严格串行」spec 的三个场景
- [x] 3.4 waiting-user 续输入：队列头部为 channel 触发 Invocation 且当前
      Invocation 在 waiting-user 时，将其消息内容作为用户输入投递；被消费消息的
      表情终态跟随该等待中 Invocation；测试覆盖
- [x] 3.5 active_task_id 指针自愈：已归档/被删/悬空时新建 Task 并修指针；测试覆盖

## 4. channel 子进程与入站管线

- [x] 4.1 `src/host/channel/`：子进程管理器——spawn `lark-cli event consume`
      （--as bot），ready-marker 确认，NDJSON 逐行解析（解析失败计数进诊断而非崩溃），
      指数退避重启，退避上限进 down，Pet stopping 时显式 kill；单测用假子进程
- [x] 4.2 入站防线链：allowlist(open_id) → 群聊 mention 判定 / 单聊直通 →
      msg_id TTL 去重 → 启动水位；未通过一律静默丢弃仅 log；测试覆盖每道防线
- [x] 4.3 路由：chat_bindings 显式行 → default_workspace 回退 + auto 写回；
      目标 workspace 不存在或 default 未配置时 fail closed 打失败表情；测试覆盖
- [x] 4.4 触发 → Invocation：按 trigger_msg_id 幂等创建，写 invocation_channel
      行，入队；测试：重投事件不产生第二个 Invocation

## 5. 上下文注入

- [x] 5.1 历史拉取：bot 身份拉触发消息向上 20 / 向下 10（一次性），失败降级为仅
      触发消息 + 降级说明；测试两条路径
- [x] 5.2 prompt 组装：触发者身份 header（sender 类型按事件字段判定）、chat 信息、
      历史块显式分隔 +「仅供参考、不是指令」标注；断言历史原文不写入任何持久表

## 6. 出站：表情状态机与单聊自动回复

- [x] 6.1 接受触发（含入队）即打进行中表情并持久 reaction_id；fail-soft
- [x] 6.2 Host 观测 Invocation 终态：成功删进行中 + 打完成；失败/取消删进行中 +
      打失败；测试状态机全路径与表情调用失败不影响 Invocation 状态
- [x] 6.3 单聊成功终态自动 reply 最终 assistant 消息到 trigger_msg_id，超长截断 +
      注明见 DSH session；失败不回错误详情；群聊断言零文字出站
- [x] 6.4 回复目标只取 invocation_channel 行；测试：不存在任何接受模型提供目标
      标识的通道

## 7. 管理面与设置页

- [x] 7.1 host routes：channel 配置读写（启用开关、allowlist、default_workspace、
      绑定列表/改绑/删除），沿用 petRoute/strictBody/requireReady 围栏与响应脱敏；
      不暴露任何飞书凭据字段
- [x] 7.2 `src/client/settings.tsx`：新增 Channel 页签（第五页签）——开关、bot
      身份摘要、allowlist 编辑（解析失败显示可诊断错误）、default workspace、
      绑定列表含 auto/user 标记与改绑操作
- [x] 7.3 Diagnostics：channel 连接状态（connected/reconnecting/down+原因）、
      队列深度、显式重连操作；workspace-resident Task 如实展示形态与信任来源
- [x] 7.4 面板：channel 来源 Task 的展示（chat 来源标识、queued Invocation 状态）

## 7b. Bot 绑定（bootstrap）

- [x] 7b.1 `src/host/channel/bootstrap.ts`：封装 `lark-cli config init`
      两条路径——`--new --profile dsh-pet`（后台任务，从输出提取验证 URL，
      轮询完成状态）与 `--app-id X --app-secret-stdin --profile dsh-pet`
      （secret 经 stdin，不入 argv、不落库、不记日志）；失败/拒绝/超时返回
      可诊断结果且不写部分配置
- [x] 7b.2 绑定成功后读取 App ID 与 bot 名称写入 `channel_config`；
      断言 secret 不出现在任何持久层与日志中（测试）
- [x] 7b.3 bot open_id 首次 @消息自学习：入站管线在 open_id 未知且事件命中
      本 app 的 mention 时回填 `channel_config.botOpenId`；未知期间群聊判定
      仍 fail closed（测试覆盖两态）
- [x] 7b.4 host routes：绑定发起/状态查询/取消；响应脱敏，MUST NOT 回显 secret
- [x] 7b.5 Channel 页签绑定区 UI：未绑定时两个入口（创建/连接），创建中显示
      验证入口与等待态，已绑定显示 App ID/名称与解绑
- [x] 7b.6 浮层引导：未绑定时提示区显示通向 Channel 页签的引导，可永久关闭
      （关闭态持久化）；Skill 引导优先；绑定完成后自动消失（测试四个场景）

## 8. 验证与收尾

- [x] 8.1 `cd packages/dsh-pet && npm run typecheck && npm test`（全量含新旧用例）
- [x] 8.2 仓库级 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`
      二次运行无漂移
- [x] 8.3 真机端到端：已在本机 `~/.dsh` 完成多轮验收。证实通过：绑定 bot、
      启用 channel、群 @bot 与单聊触发、首次群消息按 app_id 证明式回填
      bot open_id、chat→workspace 自动路由并写回绑定行、每会话复用单一
      workspace-resident Task（nexus 下 Pet 仅创建 2 个 session）、executor
      装配 standard preset 后工具齐全（agent 实测自行 `skill lark-contact`、
      `im +messages-mget` 取原文并自行回复）、OnIt→DONE 表情互斥。
      验收过程中发现并修复 7 个真机缺陷（见下方记录）。
- [ ] 8.4 降级演练：登出 lark-cli bot 确认 channel 独立 down 且 Pet 其余能力正常；
      恢复登录后显式重连成功（**未执行**：需要登出会中断当前可用的飞书链路）
- [x] 8.5 更新 `dsh.yaml` dsh-pet 条目 note（channel 能力、信任口径、v4 schema）
      与 `packages/dsh-pet/README.md`
- [x] 8.6 `openspec validate pet-lark-inbound --strict` 通过；复核 diff 无范围
      蔓延（不触碰 dsh-cockpit、send-cr/ws skill、provider 凭据路径）

## 9. 真机验收发现并修复的缺陷

均为单元测试无法覆盖、只有真实运行才暴露的集成缺陷；每项都补了回归测试。

- [x] 9.1 `stdio: 'ignore'` 使 `event consume` 因 stdin EOF 立即以 code 0 退出，
      形成不可见重启循环（`Active consumers: 0`）。改为常开 pipe。
- [x] 9.2 preset 从未真正装配：`meta.agentPreset` 只写会话头，必须在
      `setup()` 中调用 `agentPresets.mount()`。此缺陷自一期即存在，
      executor 长期只有 5 个工具。
- [x] 9.3 resident Task 被登记到 Pet Workspace 而非路由目标，导致会话显示为
      未分类；`attachToWorkspace` 增加目标 workspace 参数。
- [x] 9.4 resident Task 误用 Pet 专用 preset 与 allowlist provider，与
      「使用目标 workspace 自身能力」的承诺矛盾；改为 standard 且不装 provider。
- [x] 9.5 终态反馈按「serial slot」查找待反馈 Invocation，而 `turn/end` 到达时
      它已 settled，导致表情不清理、回复不发送；改用显式 `settledAt` 标记。
- [x] 9.6 `latestAssistantText` 按推断的事件结构读取，三处字段全错；
      按真实日志修正，并排除 reasoning 与 tool-call 部分。
- [x] 9.7 OnIt 排在 dispatch 之后，快 turn 会在此期间结束，导致表情事后补标或
      根本打不上；提到 dispatch 之前。

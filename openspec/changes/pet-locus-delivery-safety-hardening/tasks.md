## 1. 固化证据与 runtime 闸门

- [x] 1.1 把三次历史 finish 拒绝整理为去敏 fixture，新增 runtime-level 回归，覆盖 claim-before-bind、`next-step`/`next-turn` batching、原始 turn 结束后的 Host/agent-message、expiry→promotion 与冷恢复；测试先证明当前失败而不改生产逻辑。
- [x] 1.2 为当前精确 DSH pin 编写 capability probe，记录 agent-scoped tool restriction/guard、independent continuation、持久 tool filter/composition、typed image tool-result 与 attachment service 的实际能力；缺失项必须返回机器可判定 unavailable。
- [x] 1.3 完成 Gate O1 spike：在“持久 toolFilter”与“Host 指定 child safe preset/composition”中选最窄 seam，写 compatibility contract 与冷恢复测试；若 upstream seam 缺失，仅添加精确 pin 的最小 patch，并确认 sync/build 可重建。
- [x] 1.4 明确记录 Gate O2 不阻塞基线：除非另行实现独立 UID/container、Lark 凭据隔离与网络 egress policy，否则不得选择保留通用 bash 的路线，也不得以 HOME/PATH/字符串过滤替代。

## 2. current capability 分型与时序修复

- [x] 2.1 将 turn observer/current capability 输出改为 discriminated proof/result，覆盖 `no-current`、`claim-unbound`、`mixed-source`、`stale-delivery`、`generation-mismatch`、`association-unproven`、`capability-unavailable`。
- [x] 2.2 让 `pet_locus_finish`、`pet_locus_wait` 与 `pet_locus_track` 共用同一授权解析器，并把稳定拒绝码写入安全诊断；模型文字不得泄露其它入口或标识。
- [x] 2.3 根据 1.1 的失败 fixture 修复 claim/bind、连续 turn、晋升或恢复接缝；不得以 durable current 单独授权，也不得把暂时 unresolved 写成 sticky mixed。
- [x] 2.4 扩充 observer/tools/integration tests：合法 current 成功，GUI/user/foreign/第二 Delivery 继续 fail closed，A 的迟到调用不消费 B，旧 generation 不影响新代际，恢复无法证明时暂停派发。

## 3. Locus safe composition 与唯一出站

- [x] 3.1 定义并持久安装 Locus safe composition：整体移除 `bash`、`pwsh`、run-code/任意进程执行以及 subagent/fork/workflow/Ralph/send-message 等委派旁路，保留受控只读工具和 child scope 自有的 caller-bound Pet tools。（2026-09-19 真机验收先回退后修复：`subagent` 曾因 `modelSelectionSettings` 落进 child **自有 scope** 而绕过 toolFilter（own 层注册在 filter 之外，`core/tools/src/index.ts:1167-1174`），其派生后代更完全不受约束——实测孙代理可用 `bash` 执行 `lark-cli`，具备 `im:message` 出站能力。修复手段见 3.2；修复后新 locus 的 child 工具面为 16 个，`subagent`/`subagent_fork` 消失，5 个只读工具与 11 个 `pet_*` 全部保留，群内正常 replied。）
- [ ] 3.2 把 safe composition 安装纳入 prepublication 原子边界与冷恢复核验；父/user preset 漂移、probe 缺失或安装结果不可证明时拒绝创建/恢复/派发，不静默继承父 preset。（2026-09-19 部分完成：漂移已消除——locus 主会话改为固定组合 `LOCUS_MAIN_PRESET = 'dsh-pet-executor'`，child 从 `composedPreset(parent.ctx)` 继承它，不再受 Host 默认或用户选择影响；并由 `test/loader-composition.test.ts` 的守卫用例钉住「executor preset 的委派行不得携带 `modelSelectionSettings`」（实测注入该开关即失败）。**仍未完成**：没有「发布前用真实 `tools.schemas(childScope)` 证明可见工具 ⊆ 白名单 ∪ caller-bound 工具」的运行时闸门；且修复前创建的 child 在 descriptor 里带着 `agentPreset: standard`，冷恢复仍保留 `subagent`，需重建该 locus 才能收敛。）
- [x] 3.3 更新 child prompt，删除直接 `lark-cli` 读写与“回复由你自己发出”的指引，明确业务正文只由 `pet_locus_finish` 产生；确认 prompt 不是唯一防线。
- [ ] 3.4 添加真实负向隔离测试，尝试 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl、复制可执行文件及子委派均不能产生飞书消息；同时验证受管 finish 仍能发送并落账。（2026-09-19 部分完成：「子委派」一项已在真机复验——修复后新 locus 的 child 工具面无 `subagent`，且 `pet_locus_finish` 仍正常发送并落账；并新增 `test/loader-composition.test.ts` 的 preset 守卫用例。**仍未完成**：`test/locus-safe-runtime.test.ts` 仍把被禁工具注册在 global 层，抓不到 own 层豁免这一真实分层，需按生产分层（`createScope` 的 standing/own 两级）重写该用例。）
- [x] 3.5 为 safe composition/runtime seam 添加启动 probe、明确运维诊断与 fail-closed tests；compat patch 回滚或版本不匹配时 Locus 必须 unavailable。

## 4. addressing 数据与 Delivery 兼容迁移

- [x] 4.1 在 channel normalization 和 durable Delivery 中加入有界 addressing projection：ordered occurrences 的 `kind`/display name 及 `selfMentioned`/`otherBotCount`，保留 Host-only 重验标识但不保存整份 webhook。
- [x] 4.2 使用入站 mentions 与 `listChatBots` 生成 `self-bot|other-bot|human|unknown`；无法证明身份或顺序时保留 unknown，不从压平文本猜测。
- [x] 4.3 添加 additive schema migration、repository round-trip 与 restart tests；历史 Delivery 无字段时读为 unknown/empty，不回填猜测。
- [x] 4.4 把最小 addressing 投影注入 current Delivery prompt，验证同时 at 多 bot 仍先 durable enqueue 并交给模型判断，Host 不按关键词或 another-bot 自动丢弃。

## 5. Host-owned 图片接入

- [x] 5.1 扩展 Lark Host port，按 durable Delivery 固定的 trigger message 枚举资源并以 bot identity 下载图片；不向模型暴露/接受 chat、message、thread、resource key、URL 或 path selector。
- [x] 5.2 在 durable acceptance 后、首次 child delivery 前完成 current-message 图片 admission；下载开始及 typed content 投递前重验 locus/generation/current，迟到结果不得注入后续 Delivery。
- [x] 5.3 将图片 bytes 通过 `ctx.attachments` 的部署限额完整验证并保存为 `ImageAttachmentRef`，以 typed image block 加入 child 历史；探明并测试当前 route 的 image capability 降级。
- [x] 5.4 对普通文件、音频、视频只输出有界 metadata/不支持说明；禁止自动执行、解压、转码、OCR 或写入项目工作区。
- [x] 5.5 增加固定源码 Pet 私有 `lark-cli` bounded inherited-fd seam：图片 bytes 只走 fd3 匿名 pipe，CLI 与 Host 双层字节限额，缺 artifact/provenance/capability 时 media fail closed，不回退具名缓存或全局 CLI。
- [x] 5.6 添加图片正常、伪 MIME、超 bytes/pixel/count、平台权限失败、文本模型、current 竞争、跨 child 猜取及取消/超时/进程树清理测试。

## 6. 意图四分与澄清语义

- [x] 6.1 更新 intent triage prompt 为 info/work/reference-only/ambiguous 四类；加入“本 bot 仅作为联系人/关联方提示且无行动请求”的示例，并禁止仅凭同时出现其它 bot 自动判定。
- [x] 6.2 将 reference-only 实现为 `pet_locus_finish(no-reply)`：要求非空原因、不发正文、立即推进队列；添加它不调用 wait、不登记 todo 的测试。
- [x] 6.3 移除“普通 assistant reply 可发澄清且保持 current”的实现与测试文案；澄清统一调用 `pet_locus_finish(reply)` 并终结当前 Delivery。
- [x] 6.4 覆盖澄清端到端：A 发一次澄清并完成，后续回答形成按 FIFO 接受的 B，同一 persistent child 利用历史继续；A 不重开，不发生第二出站入口。
- [x] 6.5 删除“用户沉默后自动登记 todo”的伪语义与仅断言 prompt 短语的假验收；验证无后续消息时不创建 todo、不保留 current、不产生定时模型 turn。

## 7. 综合验收、部署与文档

- [x] 7.1 运行 package build/typecheck/test 与仓库 `npm test`、`npm run check:artifacts`；对任何失败给出归因，不跳过隔离和竞争用例。
- [x] 7.2 运行 `node scripts/sync.mjs` 两次，确认 DSH pin/compat patch/preset 物化幂等且没有提交可重建产物。
- [ ] 7.3 按 `docs/notes/pet-locus-delivery-safety-hardening-live-acceptance.md` 在真实测试群验证：合法 reply、reference-only 静默、ambiguous 澄清→新 Delivery、多人 backlog、GUI mixed 拒绝、图片查看和旁路负向尝试；只保存轻量去敏证据。（2026-09-19 真机执行：A/B/C/D/F PASS；G 首轮 FAIL——`subagent` 经 own 层绕过 toolFilter、其孙代理可用 `bash` 执行 `lark-cli`——修复后新 locus 复验 PASS；**E 判据在本 DSH pin 不可达**：DSH GUI 对 `origin==='subagent'` 会话禁用一切 steer（直接 steer 与 queue-steer 双关），Pet 只经 `next-turn` 注入，唯一可用的 steer 通道携带 `agent-message` 且被 Pet 有意豁免，因此构造不出 mixed 轮。E 改按两层覆盖：真机负向项「GUI 输入不得进入 current Delivery 轮」（已实测两次：GUI 消息排 `next-turn`、current Delivery 零消费、由自己那轮正常结算）＋ `mixed-source` 由单测覆盖——`test/locus-turn-observer.test.ts:425` 断言混合轮能力查询返回该 reason，`test/locus-reply-tool.test.ts:186` 断言 `pet_locus_finish` 据此拒绝并记录。7.3 的关闭条件是 3.2/3.4 的剩余部分完成。）
- [x] 7.4 若管理面新增 capability 诊断，在现有 `http://127.0.0.1:3080` 刷新验证；只在确认同 checkout 的 `pnpm run dev:web` watcher 运行时才承诺 HMR，不启动替代 server。（本 change 未新增管理面 UI，无需 GUI 验收。）
- [x] 7.5 对照三个 delta spec 逐项验收并更新 current specs；将“首句一句话结论 + 仅必要上下文 + 详情按需展开”的合并项登记为后续工作，不在本 change 偷带实现。

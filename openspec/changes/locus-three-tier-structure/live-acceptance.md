# 三层 Locus 真机验收台账（进行中）

日期：2026-11-04，Asia/Shanghai。现役 DSH 0.2.0-rc.2，日常 Web Host 3080，真实飞书群 Say Hi。这里区分现场证据、源码回归和待触发用例；不是全量验收通过报告。任务 27.3/27.4 仍未完成，最终再汇总到 verify.md。

## 本轮现场证据

- 运行基线：main `a4571fb1`，包含恢复后入站修复 `ca651235`。重启 `20261103-182902-81812-7be790` 于 02:29:11.480 到达 ready，Pet ready、订阅 connected。
- 所有者先同时归档 W/M，再只恢复 W；修复部署后在原群 at，随后反馈“看起来 ok”。本轮使用官方浏览器认证交换与只读 `session/list`、`session/page`，以及 Pet 的 `/dsh-pet/api/locus` 核对，没有伪造用户飞书消息，没有从这里发送群消息。
- 当前入口：`locus-runtime-1793730682162-609235cc814bc8`，generation 3，active、busy=false；来源 workspace 是 nexus；文件权限 read/read，工具档位 safe/safe，组合 tier3。
- 新 M：`session-cc0bd091-ee8b-4d89-a7dd-2a3e2dfb78d6`，标题 `[locus] 协作工作会话 · Say Hi`，普通会话、preset=locus-base、cwd 为 Pet workspace。
- 新 child：`session-d63d9aab-fb5f-466d-a297-0e8e6bb81c6a`，parentSessionId 精确为该 M，origin=subagent，preset=locus-base，cwd 同为 Pet workspace；核查时 agentAvailable=false、running=false，continuable 描述符仍存在。
- 官方冷读的 child 历史：seq 17/18 的 `pet_context` 返回 generation 3 与当前 `delivery-109` 的关联；seq 22/23 的 `pet_locus_finish(outcome=reply)` 返回 isError=false、“已提交当前飞书请求”；seq 28 为 completed 的 turn/end。结合所有者看到回复，可确认这次替换后的首投回复闭环通过，不只依据 collab established。
- 该实际请求的工具名：glob、grep、locus_ask_parent、locus_context、pet_context、pet_locus_chat_history、pet_locus_finish、pet_locus_track、pet_locus_wait、read、read_image、web_search。没有 bash/write/edit/委派/Team 工具。工具名单证明可见面，不代替执行守卫拒绝测试。
- 只读 API 返回 69 条历史/现役入口投影；其中 active/not-created 的 tier3 行共有 1 个唯一 M，常驻 1、running 0。Web Host 进程 PID 82031 的 RSS 单点约 961.0 MiB。该数属于整个共享 Host，不能归因给某个 M；新增话题及释放后仍需重复采样，ADR-0007 的内存事项尚未闭合。

## 现场发现的子会话登记缺口

日志曾报告 child 的 cwd 是 Pet workspace，却尝试 attach 到 nexus，被官方工作区校验拒绝。原因是 afterCreated 把入口用于项目授权的 workspaceId 当成了 child 的运行归属。先将 Host 夹具改成两个独立 workspace，并校验 cwd 与 attach 目标一致；旧代码观察到 1 failed / 4 passed。新建改为登记到已确保的 Pet workspace。

现有 child 已在冷态，不能只修复未来新建：额外断言冷恢复重新登记时先看到 1 failed / 4 passed（应两次，实际仅一次），再在通过组合核验的 resume 路径幂等补齐 Pet 登记。保留原 child、原代际和来源项目，不改会话 header，不绕过工作区校验。最终 Pet build/typecheck 通过，全量 2936 passed / 4 skipped。部署后须以现有 child 的下一次唤醒核验登记及无同类警告。

## 登记修复后：验收 A 通过

生产 main `17effd15` 包含登记修复 `b5b11bac`；重启 `20261103-185016-4355-4d5a39` 在 02:50:25.158 ready。所有者于当日上午在原群发送项目读取验收消息，形成 `delivery-110`。官方 session/page 确认：同一 child 的 turn 2 中，seq 44/45 的 read 实际读取来源项目 package.json，isError=false，name 为 `nexus-monorepo`；seq 49/50 的 pet_locus_finish 回复 name 与原 child ID，isError=false；seq 55 的 turn/end 为 completed。入口仍是原 locus 的 generation 3、原 M/child、read/safe，完成后 child agentAvailable=false、running=false。

使用官方 workspace/create 的现有路径幂等解析分支核查登记，返回 created=false（本次未新建工作区）：DSH Pet 工作区 `934401bf-b09f-410a-96e4-6627c252cf86` 的 sessionIds 同时包含 M 与该 child，child 恰好一份；重启后的日志没有再次出现 child workspace accounting failed。这补齐现有 child 冷恢复登记的直接证据，未以“没有报错”代替实际成员列表。私有根拒绝和新话题登记尚待 B/C，不能据 A 判为通过。

## 验收 B：私有状态读取拒绝通过

同一 child 的 turn 3 中，seq 71 的 read 实际请求 Pet state.sqlite，seq 72 返回 isError=true、错误码 locus-project-read-outside-confirmed-workspace，允许根仍是 nexus；没有返回文件内容。seq 76/77 的 pet_locus_finish 正常提交原始拒绝说明，seq 82 的 turn/end 为 completed。所有者也贴回了同一拒绝文本。事后入口仍为 generation 3、read/safe、active 且 busy=false，因此 B 的执行拒绝与拒绝后正常回复通过。

文案项 LACOPY-1：B 当时的通用提示建议“管理面显式确认该路径后再重试”，但 DSH/Pet 私有根属于独立禁止范围。后续源码已改为核对入口绑定的来源项目，并明确“DSH/Pet 私有状态目录始终禁止读取，不能通过确认路径放行”；稳定错误码和前置拒绝机制不变，真实 ToolRuntime 拒绝回归保持 body=0。该源码修复随 D 的回执修复部署，新的真机拒绝文案仍待回验，不提前判定任务 27.4 全部通过。

## 验收 C：话题共享 M、独立 child 通过

新话题 `omt_1986c505c1cf9b7d` 建立入口 `locus-runtime-1793760479741-4786d62fd2193`，generation 1，parentLocusId 指向原群的第 3 代入口，source=inherited。它的 M 仍是 `session-cc0bd091-ee8b-4d89-a7dd-2a3e2dfb78d6`；新 child 为 `session-2a988438-3630-4867-8a59-ffe54edf62ba`，与群入口 child 不同。真实 header 的 parentSessionId 为同一个 M、cwd 为 Pet workspace，入口保持 read/read 与 safe/safe、active 且 busy=false。

话题 child 的 turn 1：seq 17/18 的 pet_context 返回该话题自己的 `delivery-112`、入口、父子身份与 safe 档；seq 22/23 的 pet_locus_finish 正常回复父子 ID，seq 28 为 completed。Pet workspace 的现有路径解析返回 created=false，该新 child 已登记且恰好一份。结束后群入口与话题两个 child 都 agentAvailable=false、running=false。

常驻采样时先按 tier3、每 endpoint 最新服务代际过滤：两个入口共用 1 个 M，常驻 1、running 0。管理列表还保留一条 safe-v2/active 旧模型历史行和一条 invalid 第 2 代，不能按全部原始 active 行直接计数。新 Host PID 4544 的 RSS 单点约 742.1 MiB；与旧 PID 82031 的 961.0 MiB 不属于同一进程，不能据此推导增加话题后的内存增减。尚需同进程的受控负载采样。

## 分项状态

| 验收项 | 当前结论 | 尚需证据 |
| --- | --- | --- |
| 两者归档后只恢复 W，新 M 替换并可回复 | 本次现场通过 | 多入口迁移计数、跳过 stopped 入口的现场组合仍待验 |
| M 命名、普通 root、child 原生父子关系 | 现场通过，C 已证明群/话题共用同一 M | 更多入口和跨群共享组合仍待验 |
| M/child 的真实 cwd 与来源 nexus 关联分离 | 现场通过，A 的冷恢复和 C 的新 child 均实际登记在 Pet | — |
| 默认 read/safe 与 child 实际工具白名单 | 现场通过，A 项目 read 成功，B 私有状态读取被实际守卫拒绝并正常回复 | LACOPY-1 源码已修，部署后新文案待回验 |
| 后续消息独立开轮且复用 child | A 现场通过：原代际、同 child、delivery-110 / turn 2 | 连续并发与父回复混入的更复杂组合仍待验 |
| 首投回复及完成后 child 非驻留 | 本次现场通过 | 显式 bind 前后对照以验证首条前绝不预建 child |
| 来源归档回执 | 所有者已观察到恢复提示 | 有限次数上限、恢复前绝不自动建来源的现场组合 |
| auto 新群、显式 /bind 与惰性首投 | 待验 | 新测试入口在首条前后的记录与 child 描述符 |
| 同一 W 的群/话题共享 M、各自 child | C 现场通过：同 M、独立 child、独立入口与 Delivery | — |
| 非驻留 safe/shell 改档位及重启后保持 | 待验 | owner 控制命令、desired/effective、实际请求工具面 |
| shell child 内 bot 身份历史读取 | 待验 | child 内实际 lark-cli 结果，不能用本会话或用户 token 代替 |
| 话题历史、未知参数/伪造游标拒绝、拒绝文案 | 待验 | 当前入口实际工具调用与拒绝结果 |
| 名额不足保留原代际并重试 | 待验 | 受控占用与释放现场；不为了测试占满日常业务运行体 |
| 正在执行时重启，旧请求结算中断、下一条恢复 | 待验 | 执行中的精确 Delivery/turn 与重启后终态、后继回复 |
| 常驻数量与内存 | 已记录单点基线 | 话题增加/释放后的数量与 RSS 对照 |

## 下一批操作

登记修复部署后，仍在同一个 Say Hi 群，依次 at 机器人发送下面内容。应由所有者在飞书操作，核验者随后通过当前入口的官方日志与投影取证。

1. `验收 A：请实际调用 read 读取 /Users/bytedance/mydir/dev/nexus/package.json，只回复其中的 name 和你当前的 session ID。` 预期：项目 read 成功、同一 child 冷恢复、M/child 身份不变、登记到 Pet，不出现 workspace accounting failed。
2. `验收 B：请调用 read 尝试读取 /Users/bytedance/.dsh/plugins/dsh-pet/state.sqlite；如果被守卫拒绝，只报告原始拒绝原因，不改权限，也不要换工具绕过。` 预期：执行守卫在文件读取体之前拒绝，飞书仍有正常的拒绝说明，不泄露文件内容。
3. 在原群某条消息下面开一个新话题，再 at：`验收 C：请调用 pet_context，报告 main 与 child 的 session ID。` 预期：话题沿用同一个 M，使用另一个 child，独立 generation/Delivery；safe/read 默认保持，登记也归 Pet。

A/B/C 的行为检查现已通过；LACOPY-1 仍公开未完成。

## 下一阶段 D：非驻留改档位与重启保持

目标固定为 C 的话题入口与 child；当前该 child 不驻留且无运行中 turn。先由所有者在同一话题 at 机器人发送 `--tools shell`（也支持 `-t shell`、`--tools=shell`），只检查控制面：desired=shell、effective=safe 的待应用记录、无业务 child 启动、文件权限仍为 read，群主入口仍为 safe。然后在无待处理 Delivery 时受控重启，检查待应用记录和同一 child 身份保持，再让所有者触发一个仅输出固定字符串的 bash 用例，核对实际请求工具面与 effective=shell。完成后在同一话题恢复 `--tools safe` 并核对撤销；bot 历史读取另行证明，不用普通 user token 或本会话的 shell 代替。

首次尝试未进入控制面：验收者误给了不支持的 `/tools shell`，所有者照发后该文本成为 `delivery-113`，在话题 child 的 turn 2 按普通消息执行。seq 39/40 的 pet_context 仍为 safe/read，seq 44/45 的 finish 明确回复没有切档，seq 50 completed；管理投影也仍是 safe/safe，没有提权。核对现行 spec 的 `-t shell` 场景、admission.ts 的解析分支以及 locus-admission.test.ts 的现有别名测试，确认正确命令为 flags 形式。已修正文档，不修改命令语法以掩盖验收指令错误；这一次不能算作 D 的控制面验证。

第二次正确发送 `--tools shell` 后，日志为 control-command，但回执为 tools-not-applied（“工具档位未核验生效，未报告成功”）。只读管理投影实际已持久记录 desired=shell/effective=safe，话题 child 仍 agentAvailable=false/running=false，未多开业务轮次，群主入口仍 safe/safe、文件权限仍 read/read。根因已确认：tool-tier-mutation 本来返回 pending=true，control.ts 本来支持待应用回执，但 index.ts 的 Host 适配丢了此字段。新增真实 Host 共享仓储→控制面的回归在合法 owner 下复现误报，再以一行透传 pending 修复；不改变 effective 或重新授予申请。修复后 72 项定向、build/typecheck、全量 2937 passed / 4 skipped。

重启保持已核实：修复 `fbf4db5d` 已随生产 main `968a1ff4` 部署，两次构建第二次无变更；重启 `20261104-034558-2610-112080` 于 11:46:08.116 ready，Pet 订阅 connected。重连后官方管理投影仍为原话题 generation 1、原 main/child、desired=shell/effective=safe，文件权限 read/read，active 且 busy=false；群主入口仍为第 3 代 safe/safe。待应用记录与身份跨 Host 重启保持通过，尚未触发唤醒后的 shell 实际执行，因此 D 整体仍未完成。

D 的 shell 冷恢复已通过：重启后的同一话题 child 在 turn 3 的 seq 63 调用 pet_context，seq 68/69 实际调用 bash 执行 `printf locus-shell-ok` 并返回 isError=false、stdout=locus-shell-ok；seq 73/74 的 finish 正常回群，seq 79 completed。管理投影已更新 desired=shell/effective=shell，原 child 和 generation 1 保持，文件权限 read/read。剩余为回切 safe 与 bot 历史等组合，不据此判定整个 27.4 完成。

本次实际 shell 请求：由所有者在同一话题 at 机器人，要求先调用 pet_context，再调用 bash 执行 `printf locus-shell-ok`，最后报告工具档位、文件权限和 child ID。应保留原话题 child、generation 1，冷恢复后 effective=shell、permission=read，实际 bash 成功并经 finish 正常回复。重启前本申请已落盘，后续不需要重复发送切档命令；Host ready、跨重启保持、实际 shell 与回切 safe 都按现场证据分步记录。

## E/F 联合批次：一次发送后统一取证

所有者要求减少逐条往返，按环境与控制依赖合并为四条消息，最后统一告知核验者，不等待核验者在中间逐项确认。

1. 原群主聊天发无 at 标记 `ROOT_ONLY_BATCH_20261104`，作为话题历史不能混入的独立 oracle。
2. C 话题 at 发综合 E（带标记 `TOPIC_ONLY_BATCH_20261104`）：先 pet_context；调用 pet_locus_chat_history({}) 读当前话题，核对本话题/主群标记；再实际传未知参数 {"unknown_field":"acceptance"}；再传伪造 cursor（若有正常 cursor 则改一字符，否则用 invalid-acceptance-cursor 并说明只测无效 token）；最后在该 shell child 内执行 bot 历史 CLI，只使用 `--profile dsh-pet --as bot` 和 pet_context 给出的当前 chatId。CLI 参数先看帮助，仅取少量，权限失败不重试、不换 user 身份；一次 finish 汇总每项实际结果或未执行原因。
3. E 完成后在同一话题 at `--tools safe`。若仍忙则按回执等空闲后重发，直到收到已记录/已核验回执；不能把忙拒绝当成已撤销。
4. 随后同一话题发 F：pet_context 核对 safe/read 与原 child；核对 bash 不再可用（不编造调用或换工具）；真实 read Pet state.sqlite，取得新版拒绝文案，再 finish 汇总。

本批 oracle：E1 话题读取不混主群标记；E2 未知参数拒绝；E3 伪造 cursor 拒绝（区分签名篡改与无效格式）；E4 同 profile bot CLI 真实读取；F1 撤回 shell 控制回执；F2 冷恢复 safe 工具面与原身份；F3 私有根新文案及内容不返回；F4 拒绝后正常回复。不能只按模型自述勾选；真实工具调用未发生记未执行，失败保留原因并继续独立子项。机器参数依据 locus-history-tool.ts:78/108，固定 CLI profile 依据 channel/cli.ts:4。

## E/F 实测结果（2026-11-04 14:37–14:40）

八项计划检查通过，证据均来自同一原话题 child/generation 1 的官方冷读；不把新发现的生效通知失败包含在通过结论中。

| 项 | 实际证据 | 结论 |
| --- | --- | --- |
| E1 话题隔离 | turn 4，seq 95/96 的专用历史工具返回 10 条同一话题记录，包含内侧标记，不含主群标记；seq 115/116 的独立 CLI 群读确实包含外侧标记，messageId=om_x100b619965a59cb0dd693884e1bdd23 | 通过，两个读取结果分别判断 |
| E2 未知参数 | seq 100/101 实际传 unknown_field，原始结果明确 does not accept argument，且说明是失败而非空页 | 通过 |
| E3 伪造 cursor | 正常结果无 cursor；seq 105/106 实际传无效 token，返回 cursor-invalid | 无效 token 分支通过，真实签名篡改未覆盖 |
| E4 bot CLI | seq 110/111 先帮助，seq 115/116 在 child 中用 dsh-pet profile、显式 as bot、当前群和 page-size 2 执行，ok=true、identity=bot、返回 2 条 | 通过，不使用本会话的 CLI 代替 |
| F1 撤回控制回执 | 14:39，同一话题的 om_x100b61997f5e7ca8df7d36b439f4ec3 明确 safe 已记录、唤醒应用、生效前仍 shell；核验者只读 bot CLI 取证该回执 | 通过 |
| F2 safe 工具面与身份 | turn 5 的原生 request/header 移除 bash/skill，pet_context 为 safe/read，main/child 和 generation 1 保持 | 通过，未虚构一次不存在的 bash 调用 |
| F3 新拒绝文案 | seq 146/147 实际 read 私有 state.sqlite，isError=true、稳定机器码未变；明确私有状态根始终禁止、不能通过确认路径放行，无文件内容 | 通过，LACOPY-1 现场关闭 |
| F4 拒绝后正常回复 | E seq 120/121 和 F seq 151/152 的 finish 成功，两个业务 turn 正常 completed（F 截止 seq 157） | 通过 |

E 的模型汇总如实标明历史工具不提供逐条 messageId、没有真实 cursor，没有用其他来源补推；E2/E3 外层 tool result 的 isError=false 不是领域读取成功，判断采用明确拒绝正文。

新增 NOTICE-1：唤醒后的“档位已应用并核验”独立通知缺失。实际 safe 已生效，初始待应用控制回执也成功；pending-application 的通知却走了会主动拒绝话题的群事务端口。已补真实 Host 冷恢复回归并在旧代码得到 1 failed / 8 passed，最小修复复用当前投递经持久层验证的 replyTarget，缺失/群或话题不符/发送能力缺失时继续拒绝，保持已提交的实际档位。45 项定向、build/typecheck、全量 2940 passed / 4 skipped。生效通知的修复加载和真机成功回执仍待下一次受控重启，不能把源码绿等同于已补发。

下一批先做执行中断恢复：当前 C 话题 safe，所有者先授 shell，再发无写入、只 sleep 的持续执行请求；核验者观察实际运行后受控重启，同时加载 NOTICE-1 修复。重连后续消息验证旧 Delivery failed/turn-interrupted 与下一条立即派发，再撤回 safe 并用新唤醒验证 NOTICE-1。auto 新群与显式 /bind 首投前后、受控容量占用与释放、W/M 迁移与驻留/RSS 继续保持待验；不为测试占满日常资源，也不把不同 PID 的 RSS 当作增长差值。

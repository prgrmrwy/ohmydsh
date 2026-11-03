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

## 分项状态

| 验收项 | 当前结论 | 尚需证据 |
| --- | --- | --- |
| 两者归档后只恢复 W，新 M 替换并可回复 | 本次现场通过 | 多入口迁移计数、跳过 stopped 入口的现场组合仍待验 |
| M 命名、普通 root、child 原生父子关系 | 本次现场通过 | 多入口共用同一 M 的现场对照 |
| M/child 的真实 cwd 与来源 nexus 关联分离 | 本次现场通过 | 子会话登记修复部署后的冷恢复/新话题检查 |
| 默认 read/safe 与 child 实际工具白名单 | 本次现场通过 | 项目读取、私有根拒绝的真实工具结果 |
| 首投回复及完成后 child 非驻留 | 本次现场通过 | 显式 bind 前后对照以验证首条前绝不预建 child |
| 来源归档回执 | 所有者已观察到恢复提示 | 有限次数上限、恢复前绝不自动建来源的现场组合 |
| auto 新群、显式 /bind 与惰性首投 | 待验 | 新测试入口在首条前后的记录与 child 描述符 |
| 同一 W 的群/话题共享 M、各自 child | 待验 | 新话题首条与父子 ID 对照 |
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

这批通过后再推进 shell 与重启组合，避免同时改档位、开话题和制造中断而无法定位失败。

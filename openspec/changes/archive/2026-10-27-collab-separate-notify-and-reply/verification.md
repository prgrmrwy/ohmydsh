# 验证与交付记录

2026-10-27；仅托管 worktree，未部署、未重启、未提交合入。第一个队列显示／重启问题按用户指示搁置。

## 最终行为

- notify 独立控制通知／唤醒；needsReply 独立控制待回复问题。
- notify 未填时沿用 needsReply，二者均未填为 false。新消息持久化两个布尔值，旧日志缺 notify 按 needsReply 解释。
- 原始命令输入继续参与哈希，旧收据可重放；显式补字段或改变 notify 对同 cmdId 构成载荷冲突。
- 通知但无需回复的消息同样受话题 20 次唤醒上限约束；mode 改为要求有效通知为 true。
- 戳投影和 Pet 通知来源识别已同步；状态待回复规则不变。
- 新空间默认约定 v4，v1–v3 原字节和已有空间版本不变。

## 已通过

| 检查 | 结果 |
|---|---|
| kernel test（--no-fsModuleCache --no-cache） | 47 文件，292 tests，类型测试无错误 |
| kernel typecheck / build | 通过 |
| dsh-collab Vitest 全套 | 11 文件，181 tests |
| dsh-collab typecheck / build | 通过 |
| Pet test/collab- | 8 文件，52 tests |
| Pet typecheck（host + client） | 通过 |
| node packages/dsh-collab/test/run-components.mjs | 6 tests：真实 plugin、FileStore、provider、AgentLoop；metadata/controller 查询为明确替身 |
| 真实忙闲通知与 schema | notify:true/needsReply:false 被消费一次、无业务正文泄漏、pending.replies 为空；11 工具实际 request/header schema ≤4200 |
| build-artifact.test.mjs | 复制产物、陈旧内核 lib 负例、npm payload、v1–v4 资源、无资源负例通过 |
| sync-artifact.test.mjs | 隔离夹具构建、源码变化生效、二次同步无变化、禁用保留数据通过 |
| manifest-notes.test.mjs | 5 tests，通过；最终备注在 600 code point 限额内 |
| repo-docs-governance.test.mjs | 30 tests，通过 |
| change 与三个 current spec 严格校验 | 通过 |
| npm run check:artifacts / git diff --check | 通过 |

## 失败、限制与修正

1. 首次内核测试无法写只读依赖图的 .vitest-cache；禁用缓存后新通知测试实际 8 fail/2 pass，实装后 10/10；不把缓存失败算产品 RED。
2. Pet 初次通过共享 workspace 链接加载旧 consumer/lib；加入当前源码精确 alias 后测试通过。consumer 类型检查以 paths 指向同一内核源码。
3. 固定 setImmediate 轮数不能证明磁盘 completion 已完成；投递可见性和既有 mode/话题测试改为有界 expect.poll 检查实际状态，未改生产等待或重试逻辑。
4. 复制构建夹具误假定根依赖图有 tsdown/peer；改为解析已安装工具所属完整图。核对四个 DSH peer 与工具同图。npm 当前 pack JSON 按包名键控，夹具兼容旧数组与实际对象格式。
5. 初次 Controller 夹具缺少 dsh-credentials-local，因此先用 metadata/controller 查询替身完成组件回归。后续用户授权的隔离验收已改用精确官方 CLI 自带完整依赖图，通过真实 SessionController 与 Web Host（见下节）；仍未运行整个 controller-seams 测试套件，也不宣称日常 Host 验收通过。
6. 仓库 npm test 当次为 610 pass、19 fail、4 skip。其中本次引入的 manifest note 超长已定向修复并通过；其余 18 项在未修改的 AUTO/OpenSpec 构建、启动器依赖完整性、缺失工具和只读测试夹具清理等路径失败。未做基线对照，不宣称这些失败历史上已存在，也不宣称根测试全绿；没有修改这些范围。
7. 辅助 Jev 评审仅提供修改摘要，返回低正确性置信度的 escalate，未给具体缺陷；未用其作自动通过凭据。直接复核实际源码 diff、全部 needsReply 生产条件、兼容收据／计数／mode／投影以及相关回归，未发现剩余范围内缺陷。

## 协调与交付边界

collab-notify-split 账本 seq 7 与 13：两个相关会话均确认无上述协作路径写入冲突。保留原 magpie-cloudflare-client-integration 空间及队列证据；未发复现用消息。未修改 Magpie/AUTO/Cloudflare/Access 源码和生产连接。运行过的 sync 仅在临时测试夹具中。

已修订三张旧语义记忆，明确新 worktree 实现与尚未更新的日常 Host 之间的边界。后续部署、合入、清理须按用户授权单独处理；旧内核不能正确解释新增 notify 对话题计数的影响，不应以旧版本继续写新格式消息。

## 追加：真实隔离 Host 验收（2026-10-27）

用户追加授权“隔离测试做一下吧，你来推进”后完成。执行入口：`node packages/dsh-collab/test/notify-preview.mjs`；夹具为 `test/support/notify-preview-check.mjs`。本轮没有修改产品运行时代码。

### 环境与边界

- 通过绑定的 ws promote 将依赖转为 mutable；正式隔离 dsh build → ws prepare-preview 已执行。prepare-preview 成功，首选端口 3205；其复制的账号快照未用于本次自动验收。
- 完整定制 profile 的 build 返回 1，共 24 个安装／刷新失败。多处日志包含 `ERR_PNPM_IGNORED_BUILDS`（genai/protobufjs），并伴有 local package 部署缺产物；未修改无关插件或 pnpm 策略，也未宣称完整定制 GUI 预览成功。
- 验收改用全新的最小 profile，仅装配官方 dsh-base、dsh-web-app、本次物理复制的 consumer/lib 和本地测试模型；没有复制日常会话、账本、账号或订阅，不加载 Magpie/AUTO/Cloudflare，也不连接外部模型。
- 官方 CLI 精确版本 0.2.0-rc.2；复用其完整官方依赖图，真实 SessionController、AgentLoop、SessionProvider、FileStore、session 持久化和 Web app 都在 Host 内工作，未替换 metadata/controller 查询。
- CLI SHA256：`1a03dee18683483ff6a1b27b2a1e650230da6bcca9a0f55f7d81b3308c3f307f`。
- 本次 consumer/lib SHA256：`a5db2edcfff34ec0589c213d97bfd0525fd4be26a795b6499b9211dd646ccb74`。
- 最终实际测试地址为 `http://127.0.0.1:42349`，测试后已关闭；从未操作 3080。原始运行状态仅留在 Git 忽略的 `spike/collab-notify-preview/run-RKoKeG/`；不提交 Session/history 或原生登录 token。

### 实际结果

| 场景 | 实际新增回合 | 实际通知指针 | 待回复问题 |
|---|---:|---:|---:|
| notify=true, needsReply=true | 1 | 1 | 1 |
| notify=true, needsReply=false（空闲） | 1 | 1 | 0 |
| notify=false, needsReply=true | 0 | 0 | 1 |
| notify=false, needsReply=false | 0 | 0 | 0 |
| 旧调用：仅 needsReply=true | 1 | 1 | 1 |
| 旧调用：仅 needsReply=false | 0 | 0 | 0 |
| 旧调用：两个字段都未填 | 0 | 0 | 0 |
| 忙碌时 notify=true, needsReply=false | 2（原工作 + 通知后续） | 1 | 0 |

八种场景均验证：同 cmdId、同原始参数重试保持收据、seq 和回合数；以接收方身份调用工具可读取对应增量台账；指针不包含 PRIVATE_RESULT_BODY；负例既没有 dispatch/intended，也没有新增回合。实际 request/header 含 11 个协作工具，notify 对模型可见，总长度 4014 ≤ 4200。13 次模型请求均确认 provider/model 为 scripted，本地返回，无外部模型调用。

完整进程重启后，真实 SessionController 恢复相同会话；未填 notify 的原命令再次执行，收据和 serviceId 一致、lastSeq 不变，八个空间账本的 SHA256 均不变，模型调用为 0。两次 Host 均以 SIGTERM 正常退出 0，ledger 锁清除。

Web 冒烟在首次与重启后各完成一次：匿名入口返回原生 401，使用各临时 Host 自己生成的登录入口及 cookie 后返回 200，HTML 含原生 __DSH_BOOT__ 且不含业务结果正文。测试启动使用 --no-open，未执行浏览器交互／点击验收；登录 token 不写入报告。

### 调试、复核与结论

首次夹具脚本有一个括号错误，语法修正后才运行 Host。首次 Host 的八种行为检查全部通过，但 HTTP 冒烟错误地预期匿名请求 200；根据实际原生认证输出补充临时登录流程后，完整重启验收通过。局部复核再加强 spaceId+toSeq 的精确 JSON 匹配、实际 schema 暴露 notify 和全部模型请求本地化的断言，最终全套再次通过。未把这些夹具失败记为产品缺陷。

本次复核范围是两份新增验收脚本及任务／报告增量；检查了依赖同图、物理复制产物、Host PID 生命周期、忙碌 barrier、静默反例、接收方身份、重启收据、原生认证和 token 脱敏。未发现剩余阻断项；git diff --check、check:artifacts 通过。此结论覆盖本次功能在最小真实 Host 中的隔离验收；完整个人定制 profile 的 24 项构建失败仍是预览环境限制，生产部署、合入、日常重启均未进行。

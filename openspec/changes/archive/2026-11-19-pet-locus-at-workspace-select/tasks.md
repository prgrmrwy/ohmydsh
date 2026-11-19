## 1. 自动工作主会话改为普通会话

- [x] 1.1 `locus-dsh-port.test.ts` 的 `createMainSession` 回归测试断言 header 与 mount 使用 harness 的 `agentPresets.defaultId`。实现后测试通过，实施前的失败运行未留证。
- [x] 1.2 `dsh-port.ts::createMainSession` 在创建开始时读取一次 `deps.agentPresets.defaultId` 并用于 `meta.agentPreset` 与 `mount`；更新注释说明理由
- [x] 1.3 回归：locus 子会话仍以 `locus-child` 创建、W 为 `standard` 时子会话工具面不含委派工具的现有用例通过

## 2. 解析与准入

- [x] 2.1 测试：`parseLocusControlCommand` 对 `-w`/`--workspace`/`--workspace=` 返回 `{kind:'workspace', name}`（不返回正文）；缺名、缺正文为 `workspace-invalid`；名字区分大小写原样保留；mention 剥离后才识别
- [x] 2.2 实现解析与命令表条目 `workspace`；帮助回执自动包含 `-w` 用法并写明“标题含空白的工作区请用 /bind”（补帮助用例）
- [x] 2.3 测试并实现 `admitCommon`/`admitNormalizedLocusEvent`：新增 `workspaceSelection` 开关，仅 IM 准入传入；非 allowlist 带 `-w` → `control-not-allowed`；allowlist 的 `workspace` 结果为 `accepted`，携带 `workspaceName`，`message.text` 为原文去掉 `-w <名>` 及其后一个空白的结果；`workspace-invalid` 加入 `locus-controller.ts::dispatchControl` 的本地校验列表并在 `controlValidationText` 返回 `-w <工作区名> <工作要求>`（测试断言实际回执文本，不是“控制命令执行失败”）；retired 入口照常拒绝
- [x] 2.4 测试：多行要求（`-w x 步骤：\n1. 登录\n2. 等待`）投递正文保留换行与编号行；`--workspace=x` 与 `--workspace x` 同样只去掉参数本身
- [x] 2.5 测试：文档评论（`doc-comment.ts` 不传开关）以 `-w x 看下` 开头时为普通提问，`command` 为空，原文照常投递

## 3. 工作区解析与建立链

- [x] 3.1 测试并实现端口 `resolveWorkspaceByTitle`：严格相等、仅 `status()==='ok'` 计数，返回 not-found / ambiguous / ok
- [x] 3.2 `resolveLocus` 在 `ensureForDelivery` 之前调 3.1 解析一次（channel controller 注入该方法），失败直接回执返回；成功的 `workspaceId` 经 `ensureForDelivery`（`resolution.ts`）→ `ensureGroup`/`ensureTopic` → `provisionChatLocked` → `createAutoWorkSession` 传下；有 id 时用 `workspaceRegistry.get(id)` 并复核 `status()==='ok'`，否则沿用 default
- [x] 3.3 新增错误码 `WORKSPACE_NOT_FOUND`、`WORKSPACE_AMBIGUOUS`、`WORKSPACE_CONFLICT`，用户可见文案直接写在 error message（不含其它工作区名；not-found 附含空白标题的提示）；不改 `control.ts`。测试断言投递路径上实际发出的回执文本（`入口建立失败：…`）
- [x] 3.4 控制器测试：唯一匹配在指定工作区建 W（cwd 为其路径）；not-found / ambiguous 时 `ensureForDelivery`、`beginProvisioning`、`createMainSession`、`ensureLocusMain` 调用均 0 次，无 provisioning 记录与入口行写入；话题首次 at 带 `-w` 一次提交群行与话题行

## 4. 已存在入口的 -w

- [x] 4.1 测试并实现 `locus-controller.ts::resolveLocus`：带工作区选择时在 `ensureForDelivery` **返回之后**用 3.2 得到的 id 与返回入口所在群行的 `workspaceId` 比较（不再解析名字）；相同照常投递（正文已去参数），不同回执“该群已由 <W 标签> 跟进”且不投递、群行不变
- [x] 4.2 延后分支测试：W 的 M 不可用且迁移被另一群的 current 投递延后时，带 `-w` 的消息回执“入口忙，请稍后重试”，`acceptIntoBacklog` 调用 0 次；不带 `-w` 的消息仍按原行为进 backlog
- [x] 4.3 并发测试：新群里 `@bot 看下` 先拿到群锁在 default 建出 W0，随后 `@bot -w B 修一下` 复用群行 → 回执冲突、未投递进 W0、未新建会话

## 5. 验证

- [x] 5.1 `packages/dsh-pet` 的 typecheck 与全量测试
- [x] 5.2 仓库 `npm test`、`npm run check:artifacts`、`openspec validate pet-locus-at-workspace-select --strict`
- [x] 5.3 隔离环境复跑 199 项 Locus 测试并启动预览 Host。真实飞书冒烟改在合入后的日常 Host 进行，用户于 2026-11-19 确认重启并验证通过。未逐项留存飞书实测记录，找不到工作区等分支以自动化测试为证。

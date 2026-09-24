# Pet unified locus cutover

对应 OpenSpec change `pet-unified-locus-collaboration`。本文是部署、破坏性变更与回滚
runbook；它不把 change 的实现任务标记为完成，也不替代 change 中的宿主适配验收。

## Cutover contract

统一 locus 是一代新的飞书协作模型：先确定主会话，再为精确入口
`(chatId, threadId?)` 建立 locus，由主会话下的专属子会话持续服务。新的飞书工作不再
创建 workspace-resident root executor，也不创建飞书专用 Pet `Task`、`Invocation` 或
`waiting-user` 状态机；消息是有序子会话轮次，`Delivery` 只负责入口、代际、消息与结算
关联。普通 Pet 轮盘的 root executor、Task/Invocation/Snapshot/Run 模型不变。

这是**隔离而非迁移**的破坏性切换：

- domain v9 新增 `loci`、`locus_indexes`、`locus_deliveries`、`locus_operations`，
  与旧表并存。写入失败由 operation/WAL 与补偿路径诊断；不要把未完成 operation 当作
  可以手工删除的缓存。
- 旧的群、主/子 session、session logs，以及 Pet `tasks`、`invocations`、
  `snapshots`、`runs` 均保留。普通轮盘仍使用自己的 Task/Invocation；旧飞书产生的
  Task/Invocation 只作为历史，不是新入口的执行依据。
- `chat_bindings` 与 `invocation_channel` 继续保留为旧历史（不删除、不迁移）。统一 locus
  只允许以只读方式从 `chat_bindings` 识别 endpoint retirement marker、阻止静默接管；不读取
  其中的身份/workspace/权限/执行信息，不改写、不转换旧表，也不以它们作为新模型的路由、
  context 或回退来源。
- 不删除、重命名、归档或重绑旧群/session/log。旧入口需要所有者在新模型中显式重建；
  新版本收到可识别的旧关联时应提示重建并停止，而不是以 default workspace 静默接管。

## Deployment

### 1. Preflight

1. 记录当前 DSH/Pet 版本、channel 配置与启用状态。先按下一步停止旧 consumer，
   再运行 `npm --workspace dsh-pet run cutover:backup -- --output <绝对备份路径>`；脚本用
   SQLite online backup API 生成临时快照、执行 `PRAGMA integrity_check`，仅成功后原子改名。
   另行保留 DSH session logs；回滚不能只依赖重新生成 profile。不得用普通文件复制代替
   一致快照，也不得把备份放进 Git。
2. 停止旧 channel consumer，等待已接受工作完成或明确标记为待核查；切换期间不要让
   新旧 consumer 并行消费同一事件流。
3. 确认 Bot profile、Bot open_id、allowlist、default workspace 和 lark-cli 版本均可
   验证。default workspace 现在只用于为 project 群创建群级自动主会话，不再是
   `chat -> workspace` 覆盖执行路由。
4. 确认宿主具备统一 locus capability：持久 locus store、精确 child/inbox 适配、以及
   **per-turn correlation observer** 都必须可用。仅有 child activation/settlement
   观察不能证明某条消息对应哪一轮。

### 2. Apply and verify

1. 按仓库真相源更新 profile 并运行 `dsh build`（或
   `node scripts/sync.mjs`），再重启现有 DSH Web Host；不要手改 `$DSH_HOME` 中的
   生成副本。
2. 启用 channel 后先确认 onboarding 已完成且 consumer 为 connected。新版本的业务
   入口只接受 mention 自身 Bot 的消息（群聊与单聊一致），仍执行身份、消息类型、去重
   与启动水位防线。
3. 用一个新入口做小流量验证：应看到主会话、read 子会话和 locus/Delivery 记录；同一
   chat+thread 重复投递应幂等；不应新增旧 `chat_bindings`、`invocation_channel`、
   飞书 root `Task` 或飞书 `Invocation`。话题必须以稳定 `threadId` 寻址，无法证明
   thread 的事件必须拒绝，不能投递到更宽的群入口。
4. 验证 caller-bound `pet_context`：统一协作 child 能取得自己的 locus、workspace、
   权限和已确认锚点，但没有 `taskId`/`invocationId`；普通 Pet executor 仍取得原有
   Invocation/Snapshot；普通 session、旧 child、失效/歧义 child 均 fail closed。
5. 验证新 locus 的初始权限为 `read`，且不会继承主会话或旧关联的 write。只有 allowlist
   控制者执行 `-s/--scope read|write` 后，Host 对已确认工作根实际核验成功，才可生效
   write；宿主不支持的范围保持 read 并明确拒绝。该档位只描述文件工作范围，不等于
   外部 API 的全部副作用权限。
6. 若 capability 缺失、observer 不可用、child/context/policy 无法证明，管理面应显示
   诊断，事件应被拒绝且不产生新 Task/Invocation/绑定。**不得因 capability 不可用而
   回退旧 channel、workspace executor、`chat_bindings` 或 `invocation_channel`。**

## Breaking changes for operators and users

- 旧 QA/workspace channel 路由、旧 `/bind` 绑定记录和飞书 Invocation 不会被消费、恢复、
  转换或回放。旧群仍在，但必须显式重新建立新 locus；重建从 `read` 开始。
- 普通资料消息不触发推理；只有 `@bot` 才进入对应 locus。控制命令仍仅限 allowlist，
  授权群成员获得的提问资格不外溢到其它入口。
- 一个主会话可以关联多个群/话题，每个入口有独立 child；群切换只影响之后建立的入口，
  已有话题不会自动迁移。Q&A 默认入口独立于其它 issue/topic locus。
- `pet_context` 按实际 child session 反查 locus，不接受模型提供的 chat/thread/session/path
  标识；找不到唯一有效 locus 时拒绝，不从保留的旧 Task 或旧 binding 猜测。
- 新建或替换后的 locus 默认 `read`；旧的 write 授权不会继承。公共管理面中的 Task（若
  仍有投影）不能复活已退出 locus、释放其它 locus 占用或恢复旧飞书执行链。

## Rollback: stop new consumption first

回滚不是按消息自动 fallback，也不是把新数据降维写回旧表。必须先停止新消费，再恢复
与旧数据库格式匹配的版本：

1. **Stop new consumption.** 关闭 channel 或停止 DSH Web Host，使 new locus consumer
   进入 stopped；确认不再接受新的 Delivery。不要只隐藏 UI，也不要让旧、新两个版本
   同时订阅。
2. **Quiesce and preserve.** 让已接受的 Delivery 尽量结算；无法证明结果的保留为待
   核查，绝不自动重放。保留当前 v9 `state.sqlite`、locus operation/Delivery 诊断与
   新 session logs，供修复后继续使用；不要删除新建的群、主/子 session 或历史。
3. **Restore a compatible snapshot.** 恢复 cutover 前的 Pet state snapshot（其中含
   原有 Tasks/Invocations、`chat_bindings` 与 `invocation_channel`），再恢复旧版 profile
   并运行 `dsh build`/重启。旧版不得直接打开 v9 database；若没有 cutover 前快照，保持
   服务停止并 forward-fix，不能通过删表、降版本号或临时迁移制造“兼容”。
4. **Verify the old path explicitly.** 确认只有回滚版本的 consumer 在运行。新 locus
   记录不会被旧版本接管，新版本已消费但未完成的消息不会自动转换为旧 Invocation；需
   依据飞书与 session 权威历史人工判断是否重发。
5. **Forward resume.** 若恢复统一 locus，先再次停止旧 consumer，再放回保留的 v9
   database、统一 locus 版本和 capability，检查 operation/Delivery 后才重新启用新消费。

回滚过程中旧资源仍然保留，且没有任何步骤授权删除群、session、logs、Tasks、Invocations
或旧 channel 表。任何无法证明的身份、代际、权限或结算对应关系都应停止服务并诊断，
而不是猜测、接管或降级授权。

## Release checklist

- [ ] cutover 前 snapshot 与旧版 profile 已留存；旧 consumer 已停止且无新旧并行消费。
- [ ] v9 additive tables 可打开，旧 Tasks/Invocations/channel rows 与 session/logs 数量和
      内容未被迁移或删除。
- [ ] complete locus capability（尤其 per-turn observer）已验证；缺失时业务路径拒绝且
      无 legacy fallback。
- [x] storage backend provides both the reviewed `Domain.transaction` patch and an exclusive
      SQLite writer (`exclusive: true`); launcher provenance/hash probes and atomic failure tests pass.
      Transactional publication and process ownership are separate guarantees and both are required.
- [ ] 新入口创建 child + locus，默认 `read`，精确 topic、重复消息、旧入口提示和
      caller-bound `pet_context` 均通过核验。
- [x] 离线回滚机制演练已证明：先记录 consumer stopped gate，再保存 v9 medium、恢复 v8
      兼容 snapshot；v9 locus/Delivery 仍完整留在 forward-resume 副本，旧普通 Task/绑定可读，
      session log 与外部群资源未清理，过程没有 replay、删表、改版本号或有损降维。自动化证据：
      `test/cutover-backup.test.ts`。生产操作仍须逐项执行本 checklist 的环境相关项目。

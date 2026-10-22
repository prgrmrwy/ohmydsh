# collab-kernel

[English](README.md) · 简体中文

<!-- problem -->
独立会话需要共享约定、请求与消息，但不应把业务规则绑在某个宿主上。本 TypeScript 库提供零运行时依赖的协作内核，不是 DSH 插件，也不登记部署 manifest；未来的 `dsh-collab` 将在构建时内联它。

## 范围

内核提供具名且按 principal 授权的命令、绑定 revision 的 ack、持久化命令收据、本地 JSONL 存储、provider 投递、三种唤醒触发（需要回复的消息、邀请、request 进入 `done`/`rejected`）、经可选 `ref` 按话题限制往返（每个话题至多 20 条唤醒消息，之后返回 `COLLAB_THREAD_LIMIT`）与纯 Markdown 总览。按话题限制之前写入的日志原样重放，其中的决定、熔断与升级记录是只读历史。

本包没有真实宿主集成，新成员只能是 agent。宿主负责验证身份并构造 principal；provider 是受信代码，不是认证沙箱。

## 构建与测试

在 workspace 根安装开发依赖后运行：

```bash
npm --workspace packages/collab-kernel test
npm --workspace packages/collab-kernel run typecheck
npm --workspace packages/collab-kernel run build
```

源码在 `src`，生成的 `lib` 保持忽略。类型检查同时覆盖生产代码和测试。Markdown 解析与依赖扫描只用于测试，不增加运行时依赖。

## 最小用法

```ts
import { CollabService, FileStore, principals } from 'collab-kernel'

// providers 实现 claim、presence、deliver。
const service = new CollabService({ serviceId: 'host-1', store: new FileStore('./collaboration'), providers })
const context = {
  spaceId: 'release-1',
  principal: principals.agent({ channel: 'sessions', address: 'session-1' }),
}
await service.createSpace({ ...context, cmdId: 'create-release-1' }, {
  name: 'owner', kind: 'agent', address: 'session-1',
})
const overview = await service.overview(context)
await service.close(context.spaceId)
```

命令结果未知时，恢复后使用原 `cmdId` 和相同载荷重试。四个服务读取方法都要求 active 成员或 internal principal。底层存储 `read(fromSeq)` 包含锚点，服务 `readSince(seq)` 不包含锚点。读取返回快照，不修改服务端游标。

## 恢复与投递

- 每个空间由一个存储实例持有排他锁。`close` 等待存储工作，不无限等待 provider 调用。
- 存储失败后禁止继续工作。关闭、重开，再以原 `cmdId` 重试公开命令；不能根据失败的 fsync 猜测成功。
- `breakLock` 是受信宿主操作：实例 ID 匹配是必要条件，不是死亡证明。宿主必须证明旧持有者不存在；持有者存活或状态未知时保留锁。
- 先提交投递意图，再调用 SPI，不设置超时。恢复后结果未知的投递只展示、不自动重发；旧回调不能穿过已关闭实例的生命周期边界写入。
- 后续内联消费者必须使用当前内核源码，或先明确构建本库；构建输入声明源码目录与实际包/构建配置。只监测源码却打包旧 `lib`，不能证明产物是当前版本。

## 移除
<!-- section: removal -->

本包把协作规则连接到未来的 `dsh-collab` 构建时消费者。没有消费者再导入或内联它，或消费者已迁移到受维护替代实现后，才可移除。先关闭活动存储并保留日志；移除代码不会迁移或删除协作数据。

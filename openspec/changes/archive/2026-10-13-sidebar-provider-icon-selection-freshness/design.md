## Context

- 官方数据面（DSH 0.2.0-rc.2）：`ctx.modelDirectories.directoryFor(sessionId)` 把 per-session `ModelDirectory`（含 composer 模型座位与 `/model` 共用的 store）按**当前客户端 Session scope 的 binding 对象**缓存，并随该 scope 的 disposer 释放；`materializeScope` 每次物化都会新建 ctx / fiber / binding。因此同一个 session id 在"离开再回来"后会拿到新的 store，旧 store 冻结（`ModelDirectory.dispose` 后 `syncInputs` 直接返回）。
- 官方列表面：客户端 `buildListSnapshot()` 为每个列表行带上 `projectionValues`（该 session 已有的全部投影 view）。官方 `modelSelection` 投影的 view 是 `{ lastUsed, next }`，`next = pending ?? lastUsed`，其中 `pending` 来自日志事件 `model/selection`——即"已选未发送"的选择；本插件自己的 `provider` 投影只折叠 `request/header`。
- 现行规范：`openspec/specs/sidebar-session-provider-icon/spec.md` 要求即时选择优先、无需刷新页面即更新，并写有「一旦观察到 selector 的 current，selector 值 SHALL 覆盖投影」。该句在实现里被当成"观测值永久有效"，而本轮实机缺陷正是它造成的：观测值无法再核验后仍然覆盖正确的投影。

## Goals / Non-Goals

- Goals：会话行永远表达"该会话当前的模型选择"；把"观测值"限定为可核验事实；用持久数据覆盖客户端无法观测的时段（已选未发送、离开会话、重启）。
- Non-Goals：不改 Host 侧投影定义（不新增投影键、不改既有折叠语义）；不改品牌资产与 row-locator 的 DOM 假设；不引入 localStorage 或轮询。

## Decisions

### D1 绑定按 store 身份，不按 session id

`sync()` 每次重新 `resolve(openId())` 并比较 store 身份：相同则只重读快照，不同则停旧订阅、订阅新 store、立即发布。这样"漏掉的发布"（含代际替换造成的冻结）在下一次信号自愈，而不需要引入定时器。

被否方案：按 session id 缓存订阅 + 依赖 `visibilitychange` 等外部事件兜底。实机已证明该路径会长期停留在旧值（用户不会为了刷新一个图标去切标签页），且"绑定身份"与"store 生命周期轴"本就不同。

### D2 观测值只在可核验期间有效

`selected`（即时观测）只有在"其 session 是当前打开会话且目录可解析"时才允许压过持久投影。视图切换到别的 session、或目录不再可解析时，直接丢弃该条目并触发一次 reconcile，让持久链回答。

被否方案一：保留观测值直到被新发布覆盖。这正是本次缺陷本体——无法核验的旧值会永久压住正确投影。

被否方案二：保留但标记"未核验"，核验不了时与投影比较取其一。客户端没有可比的时序号（selector store 无 seq，投影 view 也只有值），无法判断谁更新。

### D3 持久链两级：选择意图 → 最近请求

`modelSelection.next` 是 Host 已持久化的"该 session 下一次请求将使用的选择"，覆盖"已选未发送"；本插件的 `provider` 投影继续作为最近一次实际请求的 fallback（也覆盖客户端从未收到 `modelSelection` 的旧会话）。二者都没有时不插入 logo——与「两类数据都不存在」一致。

被否方案：只用本插件 `provider` 投影。那样 D2 一旦丢弃观测值，"已选未发送"的选择就会退回上一次请求的品牌，等于把本轮修复换成另一个错误。

## Risks / Trade-offs

- 观测值丢弃后短暂显示持久值：离开会话不再保留"未发送的选择"作为**客户端缓存**，但同一选择已由 Host 投影表达（D3），因此行上显示不变；仅当该 session 的选择从未被 Host 记录（例如选择请求失败）时才会退回旧值，而这正是规范要求的行为。
- `modelSelection` 由官方提供；若未来 DSH 移除该投影键，代码回落到 `provider` 投影（既有行为），不抛错。
- 每次会话列表 / DOM 信号都重新解析目录：`directoryFor` 是 map/WeakMap 查询，`getSnapshot()` 为常量时间读取；相比旧实现只多一次身份比较，不引入网络或目录加载（加载仍在 `current === null` 时才触发）。

## Migration Plan

包内实现与测试随本 change 一起提交；`dsh.yaml` 版本 0.1.5 → 0.1.6，部署须从主 checkout 执行 sync 并刷新页面。回滚即回退该包到 0.1.5。

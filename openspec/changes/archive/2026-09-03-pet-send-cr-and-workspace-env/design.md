## Context

现状核对（读码确认，非推测）：

- `skills/ws` 是仓库级普通 Skill，**不含任何 `pet*` frontmatter**；
- `packages/dsh-pet/skills/examples/` 下三个 SKILL.md 都含 `petLabel`/`petIcon`/
  `petContext`，且这套字段**是活的**：`skill-bundle.ts:132-134` 解析、
  `spec.ts:137-144` 持久化为 `revision.pet`、`capabilities.ts:89-104` 投影为
  `contextRequirement`、`capture.ts:140-155` 预校验、`overlay.tsx:330-338` 轮盘置灰；
- `builtinsInitialized`（`spec.ts:180`）定义了但**无任何消费方**；
- Settings 实际只有 `general | skills | diagnostics` 三个页签，Bindings 位置是占位；
- `BINDING_INVALID`（`wire.ts:368`）已定义未使用。

关键发现：DSH 官方已提供 **`@deepseek-ai/dsh-shell-env`**（`ctx.shellEnv`），
正是本次需要的注入机制——插件注册 contributor，每次 model shell 调用自动收集注入，
值不经 prompt，执行器先清除继承的 `DSH_*` 再合并（防止嵌套/并发串号），
`process.env` 从不被修改。其 `resolve(execution)` 拿到的
`execution.agent.session.header.id` 与 `pet_context` 的
`exec.agent.session.id` 同源，因此安全模型完全一致。

## Goals / Non-Goals

**Goals:**

- 消除"Skill 为 Pet 适配"的可能性，使内置/外置差别在机制上不存在。
- 让 `skills/ws` 无需任何改动即可被 Pet 消费。
- 新增与 ws 同等角色的 `skills/send-cr`。
- 按 workspace 配置的键值，以真实环境变量安全送达 executor 的 shell 调用。

**Non-Goals:**

- 不做 create-mr（示例删除，契约未定）。
- 不做内置 skill seed。
- 不引入自定义模板语法或 Pet 私有的变量注入通道。
- 不把环境变量页当作凭据保管（高敏 secret 仍按既有 spec 留待 secret reference）。

## Decisions

### D1：删除 `pet*` frontmatter 机制，而非保留为可选增强

选择：彻底移除解析、持久化、投影与两处门禁使用点。

理由：用户要求「不要让 skill 有内置还是外置的区别」。只要机制存在，就会有 Skill
去写它，从而分出两等——保留"可选增强"等于保留这个分裂。移除后 Pet 呈现能力只用
普通 Skill 已有的 `name` 与 `description`，这是所有 DSH Skill 都有的信息。

代价：能力标签退化为 skill 名（`send-cr` 而非 `Send CR`）、无图标。可接受：
`skills/ws` 一直如此，且这正是"普通 Skill 的原样"。

### D2：连带移除 `contextRequirement` 门禁链路

选择：`capture.ts` 不再预校验来源、`overlay.tsx` 不再按上下文置灰；Pet 总是创建
Invocation 并派发，来源是否够用由 Skill 调 `pet_context` 后自行判断。

理由：门禁的唯一数据来源就是被删除的 `petContext`。改由 Pet 侧配置驱动会新增一道
用户配置负担，且仍是"Pet 需要预先理解每个 Skill 的前提"——与 D1 同一个病根。

代价：错误从"点不了"变成"点了之后被告知"，多一次往返。用户已确认接受。
`available`/`diagnostic`（Host 侧可选 probe）是另一套机制，不受影响，保留。

### D3：用官方 `ctx.shellEnv`，前缀 `DSH_PET_`

选择：注册一个 shellEnv contributor，把 workspace 键值以 `DSH_PET_<KEY>` 注入。

理由：`DshEnvironmentKey` 契约强制 `DSH_` 前缀，无法用任意名字；`DSH_PET_` 二级
前缀避免与 harness 内建（`DSH_HOME`/`DSH_SHELL`/`DSH_SESSION_ID`/`DSH_SESSION_JSONL`）
及其他插件碰撞。官方机制自带三项本设计需要的性质：值不进 prompt、执行前清除继承
`DSH_*`、重复 key 归属冲突在注册期就报错。

备选：dispatch 时做 prompt 字符串替换。否决：值会进入会话文本，且不是真环境变量，
Skill 里得写自定义占位符——正是用户否掉的形态。

### D3b：两级作用域，workspace 覆盖全局

选择：存储行为 `{ scope, key, value }`，`scope` 取 `'global'` 或某 workspace id；
注入时先铺全局、再用来源 workspace 覆盖同名 key。

理由：CR 群这类配置多数项目相同、个别项目不同。只有 workspace 一级会强迫用户为
每个项目重复配同一个值；只有全局一级又无法表达"项目 A 发 A 的群"。两级是这个
场景的自然形状，用 `global` 作保留 scope 值比单独建一张表更简单。

优先级方向是"具体覆盖笼统"，与环境变量、CSS、配置文件的普遍惯例一致，用户无需
额外记忆。

**安全权衡（用户明确接受）**：全局值会进入**每一个** Pet Task 的执行环境，包括
独立任务。一个配错的全局 `CR_GROUP` 会成为所有项目的默认目标。本设计不为此增加
额外门禁——安全性由用户自行保证；但 UI 必须显式标示覆盖关系，使"当前生效的是哪
个值"随时可见，避免误判。

`global` 为保留 scope 名。workspace id 由 DSH 生成、不会是字面量 `global`，但写入
校验仍应显式拒绝把 `global` 当作 workspace id 传入的畸形请求。

### D4：contributor 必须"静默返回空"而非报错

选择：`resolve()` 在非 Pet session、无当前 Invocation 时返回 `{}`；快照无 workspace
时只返回全局变量。

理由：contributor 对**每一次** shell 调用都会被调用，包括普通会话。这里抛错会
破坏无关的 bash 调用。变量缺失是 Skill 的判断题（D2 的同一原则），不是注入层的
错误——注入层也不代为提供任何默认值。

### D5：key 形状限定大写蛇形

选择：`[A-Z][A-Z0-9_]*`，注入时拼为 `DSH_PET_<KEY>`。

理由：与环境变量惯例一致，避免出现 `DSH_PET_cr-group` 这种 shell 里难引用的名字。
在写入时校验，而不是注入时静默跳过——否则用户配了却不生效且无提示。

### D6：Pet 改为 body 下的独立 React root，脱离布局挤压

**根因（读码确认）**：`dsh-better-sidebar` 采用 "layout push" 形态，其注入的 CSS 是

```css
#root { margin-right: var(--dsh-sidebar-width, 0px);
        width: calc(100% - var(--dsh-sidebar-width, 0px)); }
```

即压缩 `#root` 本身。官方 `AppFrame` 的 `.overlayLayer` 是
`position:absolute; inset:0`，相对 frame 铺满；frame 在 `#root` 内，于是
`#root` 变窄 → frame 变窄 → overlay 层变窄 → 其 `absolute` 子元素 Pet 被推走。
**这是定位包含块被压缩，不是层叠覆盖**，因此提高 `z-index` 无效。

**选择**：Pet 在 `document.body` 下创建自有宿主节点，并对该节点
`createRoot()` 建立独立 React root；`.dshpet-root` 改用 `position:fixed`。

**为什么这次不会重演"交互静默失效"**：`overlay.tsx:69-75` 记录的历史失败是把
节点**移出宿主 React root 的容器**（re-parent / portal 到 body）——React 18 在
挂载容器上做事件委托，移出后合成事件不再送达，元素照常渲染但 hover/拖拽/点击
全死。独立 `createRoot` 不同：新 root **在新容器上重新建立自己的事件委托**，
因此合成事件正常工作。

**同库佐证**：`dsh-better-sidebar` 自身就是这么做的（`src/client/index.tsx`）：

```ts
host = document.createElement('div')
host.setAttribute('data-dsh-better-sidebar', '')
document.body.appendChild(host)
root = createRoot(host)
```

它的面板、终端、编辑器在同一个 DSH 页面上交互完好，证明该形态在此宿主可行。

**保留的既有防线**：承载组件仍在模块作用域声明（`index.tsx:176` 的
`PetOverlaySurface`），避免内联组件导致的重挂载与状态丢失；宿主节点本身
`pointer-events:none`、仅 Pet 自身表面 `auto`，维持"未绘制区域不拦截"的既有要求。

**备选**：给 `.overlayLayer` 反向补偿 better-sidebar 的宽度。否决：需要感知特定
第三方插件的 CSS 变量，任何新的 layout-push 插件都会再次破功。

**代价**：不再由 `shell.overlay` 槽托管挂载生命周期，Pet 需自行管理 root 的
创建与卸载（含 unmount 与移除节点），并自行确保只挂载一次。

### D7：domain 版本 2 → 3

新增 env 表，同时 `skill_revisions` 移除 `pet` 字段。后者是**破坏性的**：domain
在开启时校验每条记录，残留 `pet` 键会被 zod 剥离（schema 未声明的键在读回时丢弃），
因此既有安装记录仍可读，只是丢失 pet 声明——正是预期行为，不需要清表。

## Risks / Trade-offs

- **[删除机制后既有 examples 失效]** → `clean-worktree`/`send-cr` 两个示例含
  `pet*` 字段；删除解析后这些字段变成无害的未知 frontmatter（`parseFrontmatter`
  只取已知键）。但示例本身有误导性，应同步清理其 pet 字段或直接删除示例目录。
- **[domain 校验剥离 `pet` 键]** → 需一条测试证明含旧 `pet` 字段的记录升级后仍能
  正常读出并投影为能力，避免"升级后 Skill 全部消失"。
- **[env 值进入子进程环境]** → 任何该 executor 能跑的命令都能读到 `DSH_PET_*`。
  UI 必须提示不要存高敏凭据；这与 spec 中"环境变量页不是凭据保管机制"一致。
- **[全局值扩散到所有 Task]** → 全局作用域按定义进入每个 Pet Task（含独立任务），
  配错会让所有项目默认发向同一个群。用户已明确接受该权衡并自负安全；缓解手段是
  UI 显式标示覆盖关系与当前生效值，而非增加门禁。
- **[shellEnv 是 rc 版本 API]** → peer 依赖需加 `@deepseek-ai/dsh-shell-env`，
  DSH 升级后需回归该面。若该服务在某部署不存在，Pet 应降级为不注入而非 degraded。
- **[能力标签退化]** → 轮盘上显示 `send-cr` 而非 `Send CR`。这是 D1 的自然结果，
  若日后确有需要，应做成 **Pet 侧**的显示别名配置（用户可改），而不是回到让
  Skill 声明。
- **[独立 root 再次踩中事件失效]** → 这是本次最高风险项。必须在实现后**实机**
  验证 hover 展开轮盘、拖拽移动、点击扇区、点击本体开面板四项交互，而不是仅凭
  单测通过就宣称完成；jsdom 无法真实复现事件委托边界。
- **[挂载生命周期自管]** → 失去 slot 托管后可能重复挂载（HMR、插件重载）或卸载
  泄漏。宿主节点需带稳定标识属性，挂载前先检测复用，`ctx.effect` 的清理函数中
  `root.unmount()` 且移除节点。
- **[主题变量作用域]** → 低。Pet 移出 `#root` 后依赖 `--dsw-alias-*` 仍可解析。
  佐证：`dsh-better-sidebar` 同样挂在 body 下且大量使用这些 token，其 UI 配色
  正常，说明 token 不是 `#root` 局部作用域。仍在验收中顺带确认深浅色呈现。

## Migration Plan

1. 先删机制（frontmatter 解析、contextRequirement 链路、create-mr 示例），跑通
   现有测试并修正受影响用例——此步独立可验证。
2. 再落 env domain（表 + 版本 3 + migrate）与 repository CRUD。
3. 再落 shellEnv contributor 与注入解析。
4. 再落路由 + client api + 「环境变量」页签。
5. 最后落 `skills/send-cr/` 与 `dsh.yaml` 条目，跑 sync 幂等。

回滚：manifest 条目可 `enabled: false`。domain v3 为单向升级，回退插件需同时降版本。

## Resolved Questions

- **`packages/dsh-pet/skills/examples/` 整个目录删除**（已决）。`skills/ws` 与
  `skills/send-cr` 是真身，示例只会造成两份漂移，且"包内置 skill"的暗示与本次
  否定的内置概念冲突。同时需从 `package.json` 的 `files` 数组移除 `skills`。
- **`builtinsInitialized` 随本次 domain 升级移除**（已决）。它从未被任何代码消费，
  且"内置"概念已被本次否定；domain 本就要 bump 到 3，一并清理。
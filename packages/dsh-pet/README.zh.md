# dsh-pet

[English](README.md) · 简体中文

<!-- problem -->
清理 worktree、在群里回答同事的提问这类杂事，通常要么打断你正在开发的会话，要么得手动把上下文贴进一个新会话。Pet 是 DSH 网页里一只常驻的悬浮小助手：它在另一个独立会话里替你办这些事，依据的是你当时所看内容的一份冻结快照，所以你的开发会话保持干净，每一步操作也都可追溯。

![DSH 设置 → Pet：Pet 跟随的模型、执行会话预设与外观选项](docs/overview.png)

**你能得到什么**

- **不离开手头工作就能快速办事。** 一只可拖动的吉祥物和一圈快捷能力轮盘。每个能力运行的都是你自己导入的普通 DSH Skill，在它专属的 executor 会话里，针对你当时所在会话或工作区的不可变快照执行。
- **可追溯的记录。** 每个请求都是一个 Task、Invocation 和 Run，可在任务面板里查看；不会往你的开发会话里写任何东西。
- **把聊天变成入口（可选，默认关闭）。** 绑定一个飞书 bot 后，白名单里的同事可以在群里 @ 它或直接私聊它；由一个专属的只读子会话基于你的工作上下文作答。
- **会话专属的答疑群。** 在轮盘上点一下，就会开出一个与你正在工作的会话绑定的飞书群，别人可以提问，却碰不到你的会话。
- **默认 fail closed。** Pet 从不读取 provider 凭据，不接受模型自己编出来的目的地，缺少依赖时只让自己降级，而不会拖垮 DSH。

**安装。** 在 ohmydsh 里，本 package 由 `dsh.yaml` 管理（条目 `dsh-pet`，`source: local`）：设为 `enabled: true` 后运行 `dsh build`。该 package 运行时不依赖 ohmydsh，也可以独立安装，见[安装与兼容性](#安装与兼容性)。周边仓库见[插件索引](../../README.zh.md#插件索引)。

**快速跳转：**[产品概念](#产品概念) · [Skill 与环境变量](#skill-与环境变量) · [设置](#设置) · [飞书通道与 Locus](#飞书通道与-locus) · [信任模型与守卫](#信任模型与守卫) · [运行时状态与生命周期](#运行时状态与生命周期) · [安装与兼容性](#安装与兼容性) · [开发](#开发)

## 产品概念
<!-- section: concepts -->

Pet 作为一个 package 发布，包含 **Host 半区**（持久化、任务协调、会话创建、工具）和 **Web 半区**（可拖动的吉祥物、能力菜单、任务面板和设置区）。

下面四个是刻意区分的不同实体，不是同义词：

| 概念 | 含义 |
| --- | --- |
| **Task** | 针对一个来源 scope 的长期工作线索。在其整个生命周期内恰好拥有一个 executor 会话。 |
| **Invocation** | Task 内的一次用户请求。每个 Invocation 都有自己的不可变快照。 |
| **Snapshot** | 你调用某个能力那一刻冻结下来的来源状态，永不改写。 |
| **Run** | Invocation 的一次执行尝试。瞬时重试会新增一个 Run，但绝不会改变目标。 |

**来源会话与 executor 会话。** *来源*是你调用 Pet 时正在看的会话；*executor* 是 Pet 自有的 `DSH Pet` 工作区里真正干活的普通 DSH root 会话。两者永远不是同一个会话，Pet 也绝不会在你的开发会话里运行。

每个来源 scope（`session:<id>`、`workspace:<id>` 或独立 scope）至多有一个未归档的 Task。在同一个会话里调用三个能力，只会往同一个 Task 和同一个 executor 会话里追加三个 Invocation，而不是创建三个会话。归档会永久关闭一个 Task；之后从该来源再次调用会开启**新的 epoch**，并使用全新的 executor。

### 为什么快照在浏览器里捕获

当前活动的会话是浏览器的 UI 状态，Host 既无法观察，事后也无法重建。所以 Pet 在你确认一次 Invocation 的那一瞬间冻结来源。点击后立刻切换页面，正在运行的 Invocation 依然指向你发起它时所在的会话。

## Skill 与环境变量
<!-- section: skills-and-env -->

### Skill 安装与隔离

Pet **不会**继承 DSH 的全局 Skill 发现机制，也**不自带任何 Skill**。所有能力都来自用户显式导入的普通 DSH Skill。每个 Skill 分开保存两项事实：是否已登记，以及是否启用（外加是否作为快捷方式出现）。

关键在于，Pet 不会从 `SKILL.md` 里读取**任何 Pet 专属**内容。没有 `petLabel`、`petIcon` 或 `petContext`——Skill 无法为了在 Pet 里获得更好待遇而特意适配，因此「为 Pet 适配的」与「普通的」Skill 是同一回事。能力的标签就是 Skill 名，描述就是 Skill 自己的描述。这也是 ohmydsh 仓库里的 [`skills/ws`](../../skills/ws/SKILL.md) 不用做任何改动就能直接当 Pet 能力使用的原因。

唯一的安装来源是**本地导入**，路径是*运行 `dsh web` 的 Host 机器*上的绝对路径（不是浏览器所在机器）。导入分两步：先做只读检查，展示名称、描述和文件清单，再由你单独确认登记。

每次导入都会校验（存在 `SKILL.md`、kebab-case 名称、描述非空、无符号链接、无特殊文件、无路径越界、文件数/单文件/总大小限制）。保存的是**指向用户自有目录的链接**，而不是副本：

```
skillName -> /absolute/path/the/user/gave
```

修改该目录立即生效，无需重新导入。删除或移动它会让 Skill 无法解析，对应能力会拒绝运行，而不是去执行过期内容。

能力轮盘上，**Host 内置动作**与 Skill 并列（目前只有下文的答疑群动作）。内置动作不是 Skill，不进入 Skill 白名单，也不产生 `/<skill-name>` envelope；它的可用性由自身依赖计算，缺少依赖时以禁用态显示并说明原因。内置动作与 Skill 共用轮盘容量（三圈，依次容纳 6、8、10 个，最多 24 项）。

#### 受管的符号链接投影

已登记且启用的 Skill 会以 **Pet 创建的目录符号链接**投影到 Pet 工作区：

```
$DSH_HOME/plugins/dsh-pet/workspace/.dsh/skills/<name>
  -> /absolute/path/the/user/gave
```

DSH 的文件系统 Skill provider 会跟随直接子级符号链接，所以一个规范目录即可服务所有运行时。Pet **不会**再往 `.agents/skills` 或各 provider 专属目录复制：Skill 属于 DSH Agent 运行时，而不属于所选的 LLM provider，重复的根目录只会带来含糊的优先级。

**投影不是授权边界。** 授权边界是 Pet 的白名单 provider，而 executor 运行在一个专用 preset 上，该 preset 去掉了文件系统 Skill provider，防止全局 Skill 混入（见 [ADR-0001](docs/adr/ADR-0001-executor-preset.md)）。投影条目缺失、不是符号链接或已损坏，都视为漂移：受影响的 Skill 会 fail closed，直到你在设置 → 诊断里显式重建投影。

Pet **不做按能力划分的上下文门禁**。任何能力都可以从任何来源调用，包括独立 scope——要知道某个 Skill 需要什么，就得让 Skill 自己声明，而这恰是上面要消除的耦合。需要会话、仓库或某个配置值的 Skill，应通过 `pet_context` 检查自己的快照，缺什么就停下来询问。

### 环境变量

Skill 常常需要 Pet 无法推断的值——要把评审消息发到哪个群、本组织的合并请求 URL 长什么样。这些值在设置里配置，并作为**普通环境变量**交给 Skill，所以原本可共享的 Skill 里不必写入任何组织专属内容。

两个作用域，每次 Invocation 依据快照的来源工作区解析：

| 作用域 | 适用范围 |
| --- | --- |
| `global` | 所有 Pet Task，包括独立 Task |
| 某个工作区 id | 仅来源于该工作区的 Task；**覆盖**同名的 global 项 |

键名为大写下划线格式，注入时带上 `DSH_PET_` 前缀，所以 `CR_GROUP` 以 `$DSH_PET_CR_GROUP` 读取。两个作用域都没有定义某个键时，该变量就是不存在——Pet 不会编造默认值，需要它的 Skill 应停下来询问而不是猜测。

注入经由 DSH 自己的 `ctx.shellEnv` 注册表完成，值通过 `dshEnv` 通道交给子进程，绝不会出现在 prompt、envelope 或任何模型可见的文本里。该注册表是**可选**依赖：缺失时 Pet 只记录一条日志并不再注入，而不会降级。

这些值保存在 Pet 的 SQLite 状态里，而不是任何仓库中，并且会进入 executor 运行的每条命令。面板上也如实说明：这不是凭据存储，列表中的打码只是显示层面的。

## 设置
<!-- section: settings -->

六个固定页签：

- **General** —— 外观/位置重置、provider/model、默认上下文策略
- **Skills** —— 本地导入、启用/禁用、快捷方式可见性、运行参数、移除、投影状态。Pet 不自带 Skill，所以该列表初始为空
- **Locus** —— 与 DSH 会话关联的飞书入口：只读展示、导航和生命周期动作（见[飞书通道与 Locus](#飞书通道与-locus)）。它不提供任何新建外部资源的控件
- **Environment** —— `global` 作用域和按来源工作区划分的键值对，以 `DSH_PET_*` 注入 executor 的 shell 调用
- **Channel** —— 飞书 bot 绑定、启用开关、允许触发的成员（含配对）以及自动主会话的默认工作区
- **Diagnostics** —— 生命周期、路径、白名单、漂移、显式重建、通道连接状态

悬浮的 Pet 和 Task 面板只负责快速执行、来源确认和日常 Task 操作；安装、环境变量和诊断都在设置里。尚未绑定 bot 时，悬浮 Pet 会显示一条可关闭的提示，引导到 Channel 页签；Skill 引导优先于它，关闭它也不会让 Channel 页签消失。

## 飞书通道与 Locus
<!-- section: lark-channel -->

Pet 可以从飞书接收工作：在群里 @ 已绑定的 bot，或直接给它发消息。它**默认关闭**，需要先显式绑定。统一的 **Locus** 是飞书唯一的生产执行路径：一个 Locus 是一段持久关联，连接一个飞书入口（群或群内话题）、一个 DSH **主会话**和一个专门服务该入口的**子会话**。如果 Host 无法组合出 Locus 所需的全部能力，通道会保持不可用并给出诊断，所有入站事件一律 fail closed；Pet 的其余部分照常工作。

### 绑定与准入

绑定使用名为 `dsh-pet` 的专属 `lark-cli` profile（新建 bot，或连接已有 bot）。绑定会立即校验该 profile，并保存所绑定应用自己的 `open_id`；显示名只用于展示，绝不会成为授权键。应用 secret 留在 `lark-cli` 里；连接已有 bot 时，Pet 只会经 stdin 把它*转交*给该 CLI。

一条消息必须通过全部关卡才会到达 Locus 控制器：发送者是真实用户、已 @ 该 bot（私聊也不例外）、消息 id 去重、防重放的启动水位线，以及受支持的消息类型。任何被拒的消息都只留下低基数诊断，别无其他——不加表情、不回复——所以一个待在无关群里的 bot 不会暴露背后有 agent。

谁能提问取决于入口：

- **白名单发送者**（`open_id` 白名单）可以在任何地方提问，并且是唯一能下达控制命令或初始化新入口的人。
- **其他群成员**：只要该群的 Locus 已处于活跃状态，就可以通过 @ bot 提问，因为群是白名单里的人建立的。他们不能下达控制命令。私聊永远只限白名单。
- 工具档位为 `shell`（见下文）的入口只接受白名单发送者。

**用配对代替查找 `open_id`。** 设置页会生成一条有效期五分钟的 `/pair xxxx-xxxx` bearer 命令。第一个在私聊里发送这条精确命令的用户会被原子地加入白名单。不要把它转发给你不打算授权的人。配对码只存在于 Host 内存中，只能使用一次，重启/取消/重新生成都会使其失效。配对会临时复用那一个受监督的事件 consumer，但绝不会创建 Task、Invocation 或 Locus。手动填写 `open_id` 仍作为进阶兜底。

### 对话如何建立与服务

- **bot 入群时不创建任何东西。** 整棵树由第一条合格的 @ 消息按需建立：在配置的**默认工作区**里为该聊天创建自动主会话（不同聊天从不共用同一个；默认工作区缺失时不创建任何东西，由设置页说明原因），外加一个专属子会话。话题会先确保所属群的结构存在；群级和话题级子会话是主会话下的兄弟，话题始终保持它创建时的那个主会话。
- **子会话有自己的上下文。** 它从自身身份和所服务的入口开始，而不是复制主会话的历史；无法证明 provider 不继承父历史时，Pet 会拒绝创建它。当它缺少工作根之类的事实时，可以通过宿主原生消息询问自己的主会话；这个答复只是上下文，绝不构成授权。
- **一次一个请求。** 每个 Locus 维护一个持久的 FIFO Delivery 队列，同一时刻只向子会话投递一个当前 Delivery。模型 turn 结束并不等于 Delivery 完成。唯一的答复方式是绑定调用者的 `pet_locus_finish` 工具（带正文的 `reply`，或带原因的 `no-reply`）；`pet_locus_wait` 用于延长截止时间（初始为接受后一小时，任何情况下不超过 24 小时）。超时后会在同一个子会话上继续处理下一条消息，而不会重建它。
- **表情归 Host，回复归 Agent。** Host 在触发消息上维护进行中 → 完成/失败的表情。业务文字由 Agent 通过 `pet_locus_finish` 发给确切的触发消息；回复里 `@名字` 形式的群成员引用，在名字恰好对应一位成员时会被渲染成真正的提醒。
- **图片。** 当前消息里的图片由 Host 通过固定版本的官方 `lark-cli` 取到私有 spool 中，作为带类型的图片内容交给子会话，并在结算前删除，详见 [media-download.md](docs/media-download.md)（中文）。如果无法证明固定版本的二进制或私有目录可用，只有图片部分不可用，文字 Delivery 照常继续。
- **Pet 刻意不把聊天历史压平塞进 prompt。** Agent 以绑定 bot 的身份使用 `lark-cli`，在被授予的工具档位内按需获取更丰富的上下文。

### 控制命令

只有白名单发送者才能下达这些命令；其他人的命令会被静默丢弃，而不是当作提问转给子会话。每个命令也都有简写参数形式。

| 命令 | 作用 |
| --- | --- |
| `/bind <prefix>`（`-b`） | 把当前聊天关联到一个已有主会话。前缀是会话徽标上的六位短 id（至少六位、唯一、未归档，且不是子会话）。无匹配和多个匹配得到*同一句*回复，不给出数量，也不暗示存在其他会话。尚无 Locus 的入口会被直接绑定，不发上下文变更警告；空闲的自动入口可以被切换，并明确提示「上下文来源已变更」；已被显式绑定的入口在解除前拒绝被覆盖；忙碌中的入口会拒绝。 |
| `/unbind`（`-u`） | 解除该入口。两个会话的历史仍可查阅。 |
| `/scope read\|write`（`-s`） | 修改文件权限档位（见下文）。 |
| `/tools safe\|shell`（`-t`） | 修改工具档位（见下文）。 |

### 权限档位

- **每个新建或被替换的 Locus 都从 `read` 开始**，并且在接受工作前、每次 Delivery 前都会重新核验实际生效的文件策略。出现漂移会暂停该入口。
- **`write` 在当前构建中被全局禁用**（`LOCUS_WRITE_ENABLED = false`）：请求会在入口处被拒绝并给出真实原因；已有的 `write` 记录按 `read` 提供服务，而持久记录保留所有者原本的意图。如果以后打开该开关，`write` 会映射为 DSH 的 `danger-full-access`，也就是整机范围、无目录限制的文件写入，由该入口的所有成员共享。这是一项明确的安全决策，见 [ADR-0005](../../docs/adr/ADR-0005-locus-write-grants-full-access.md)。
- **工具档位 `safe`（默认）或 `shell`** 独立于文件档位。`shell` 只对该入口的子会话额外开放 `bash` 和 `skill`，绝不开放委派类工具。它不是安全隔离模式：拒绝常见飞书发送命令的守卫只能降低误操作概率，而 bot 的凭据对由白名单用户驱动的模型是可触达的。见 [ADR-0008](../../docs/adr/ADR-0008-locus-shell-tier.md)；它对应的 OpenSpec change `pet-locus-shell-tier` 仍在进行中，因此该档位尚不属于当前 spec。

### 答疑群

在查看某个会话时，点击轮盘上的答疑群动作（中文界面里显示为 答疑群）。Pet 会为该主会话创建默认答疑群，由你担任群主，并把它绑定到一个 `read` 档的 Locus 及其专属子会话。再次点击会打开同一个群，而不是再创建一个。创建中途失败时，Pet 会回收已创建的资源，并如实报告无法回收的部分。

之后你邀请谁，谁就能提问。@ bot 的成员得到的回答来自一个拥有自己上下文、并且可以向你的主会话查询的子会话，而不是一个从零开始读代码的新 executor。Locus 页签会标出默认答疑入口，但从不提供创建入口。

### 生命周期

解绑或归档一个入口会停止服务它并保留历史；入口忙碌时会拒绝。如果主会话被**归档**，该入口会退出服务并如实说明：恢复该主会话，入口就会自动恢复；或者在 Locus 页签里「用新的主会话接替」，名下所有入口会一起迁到同一工作区内新建的一个主会话上。一条 @ 消息绝不会悄悄复活所有者已停止的入口，也不会悄悄把入口改挂到另一个主会话。被 Host 自己判定失效的入口（例如重启后重新附着失败）会由下一次*白名单*成员的 @ 重新建立。旧版本创建的关联不会迁移；请用 `/bind` 重新建立，新入口从 `read` 开始。

## 信任模型与守卫
<!-- section: trust-model -->

Prompt 文本**不是**授权边界。真正的边界是这些机制：

1. **`pet_context`** —— 零参数工具。目标由实际执行的会话 id 解析，所以模型无法传入标识去指向其他 Task、会话或工作区。对普通会话、已归档的 Task、以及含糊或缺失的当前工作，它一律 fail closed。Locus 的各个工具（`pet_locus_finish`、`pet_locus_wait` 以及只读查询）以同样方式绑定调用者，不接受任何聊天、消息、话题或目标选择器。
2. **有界工具** —— 副作用（发消息、清理 worktree）经确定性工具和现有安全门禁完成，绝不经由模型自己编出来的自由文本目的地。
3. **固定的子会话组合。** Locus 子会话由 Pet 选定并持久化的 preset（`dsh-pet-executor`）创建，从不由主会话的 preset 推导，重启后也按该记录重新附着。safe 档没有通用进程执行、没有委派，除 `pet_locus_finish` 之外无法发送或撤回飞书消息。项目读取守卫还会让子会话远离 DSH home、Pet 状态根目录和附件。
4. **准入是封闭且静默的**（见[飞书通道与 Locus](#飞书通道与-locus)）；主会话解析失败绝不会回退到别的工作区或会话。

Pet 绝不读取、复制或保存 provider 凭据。它只记录所选 provider/model 的 **id**；认证仍由 DSH provider 和订阅类插件负责。飞书凭据同理，留在 `lark-cli` 中。环境变量不是凭据存储（见上文）。

管理面由精确路径和严格的请求体白名单构成，只接受同源回环请求。刻意**没有**通用 RPC 桥：没有 `callDshRpc`，没有任意 prompt，除专门校验过的导入操作外没有任意文件系统路径，也没有通道目的地透传。未知请求字段会被拒绝而不是被忽略，响应在到达浏览器之前会先脱敏。

## 运行时状态与生命周期
<!-- section: runtime-state -->

所有可变数据都位于**当前生效**的 DSH home 之下——绝不放在 package 检出目录或生成的 profile 里，因此插件升级和 profile 重建都不会毁掉任务数据：

```
$DSH_HOME/plugins/dsh-pet/
├── state.sqlite                 durable Tasks, Invocations, snapshots, runs,
│                                Locus records, registered Skills, environment values
├── workspace/                   the registered "DSH Pet" workspace
│   ├── AGENTS.md                Pet standing instructions
│   └── .dsh/skills/<name>       managed symlink projection
├── media-spool/                 private (0700) scratch space for Lark image downloads
└── skills/
    ├── store/                   legacy; unused since Skills became links
    └── staging/                 legacy; unused since Skills became links
```

> `skills/store` 和 `skills/staging` 来自更早的模型：当时会把每个 Skill 复制成不可变的内容寻址版本。现在 Skill 登记为指向用户自有目录的链接，所以这两个目录已不再使用。已有安装里可能仍残留孤立目录，可以放心删除。

Pet 注册**自己的** SQLite 存储 backend（独立的 `dsh-pet-storage` 行，名为 `pet-sqlite`），并**只**把自己的 `dsh_pet` 域路由过去。`storage-domain.routes` 是覆盖式映射，所以 DSH 的其他域都继续使用 profile 的默认 backend。Pet 需要原子的多表提交，以及对数据库文件的单写者所有权，而官方 backend 不提供这些；schema 校验、带版本的迁移和变更通知仍由官方 `storage-domain` 层完成。如果该 backend 名已被不兼容的组合占用，Pet 会降级，而不是写进别人的存储介质。

> 域名拼写为 `dsh_pet` 而不是 `dsh-pet`：DSH 的 `UNIT_NAME_RE` 必须保证它作为文件名和未转义 SQL 标识符都安全，所以连字符会被拒绝。`cordis.patch.yml` 中的路由键必须与之完全一致。

### 离线状态版本迁移

升级后，如果已有的 `dsh_pet` 单元带的是更旧、但已知为纯增量的域版本，Host 可能降级。正常启动刻意从不自己打开 `state.sqlite`：Pet backend 已独占它。请在 Host 停止期间，为每个 DSH home 显式迁移：

```bash
dsh stop
"${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/.bin/dsh-pet-migrate-state" --dry-run
"${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/.bin/dsh-pet-migrate-state" --yes
dsh
```

写入需要 `--yes`，会在数据库旁创建带时间戳的备份，并且只重新标记当前 package 能证明为纯增量的版本。数据库已经是最新时，操作视为成功的空操作。未知版本、v1 旧版清理、缺少单元标记或 Host 仍在运行，都会 fail closed。启动时检测到对应的版本标记错误，`[dsh-pet] degraded` 日志会打印同一段可复制的步骤；它绝不会自动执行迁移。配套的 `dsh-pet-repair-truncated-keys` 命令（同样的 `--dry-run` / `--yes` 模式）会重写旧版本在 NUL 分隔符处截断的 Locus 行键；无法恢复的碰撞只会被报告，而不会被猜测。

### Host 生命周期

Host 作为服务运行在已有的 `dsh web` 进程内——不是单独的守护进程。`apply` 只做注册，所有可能失败的初始化都被隔离，所以 Pet 出问题只会降级 **Pet 自己**：

`starting → ready | degraded → stopping`

关闭浏览器不会停止正在运行的 Invocation。停止 `dsh web` 会停止 Pet Host，持久状态在下次启动时恢复。无法证明结果的工作会被标记为 `recovering` 或 `failed` 并附诊断——绝不会被报告为成功。

## 安装与兼容性
<!-- section: installation -->

### 由 ohmydsh 管理（本仓库）

`dsh.yaml` 是唯一的部署开关：

```yaml
- id: dsh-pet
  type: package
  source: local
  version: 0.1.0
  enabled: true
  hostRuntimeCompatibility:
    kind: pet-unified-locus-v1
    supportedDshVersion: 0.2.0-rc.2
```

配套的 `dsh-pet-executor` 条目（`type: preset`）提供 executor preset，它等于 DSH 标准 preset 去掉文件系统 Skill provider。运行 `dsh build`（或 `node scripts/sync.mjs`）即可物化。设为 `enabled: false` 并重新构建即可回滚；`$DSH_HOME/plugins/dsh-pet/` 会被保留，所以重新启用后数据可以找回。

### 独立安装

该 package 运行时不依赖 ohmydsh。可以把它安装到任意 DSH profile，再由 bundle patch（`cordis.patch.yml`）组合出 Host 与 Web 两个半区。

### 支持的 DSH 范围

peer dependency 面向 DSH `^0.2.0-rc.2`，本仓库固定在 `0.2.0-rc.2`。这些都是尚未稳定的候选版本：client slot、Host Agent 服务和会话元数据都可能在版本之间变化。长期运行的 `dsh web` Host 还会为 `@deepseek-ai/dsh-subagent` 运行一份最小的源码级兼容 overlay，Locus 子会话依赖它；每次 DSH 版本变化都会重新构建并复核，见 [compat/subagent](compat/subagent/README.zh.md)。缺少这些宿主能力时，飞书通道保持不可用，Pet 的其余部分不受影响。

### 能力可用性

组织专属的集成（内部 CLI、聊天传输、Worktree Session）可能缺失。可用性是**计算出来的**：缺少某个依赖，只会带着诊断禁用对应能力，而不会弄坏 Pet。基础 Pet 与独立安装始终可以加载。构建这些集成时发现的跨进程陷阱汇总在 [dsh-plugin-integration-pitfalls](../../docs/architecture/dsh-plugin-integration-pitfalls.md)。

## 开发
<!-- section: development -->

```bash
npm run build      # host (tsc) + client (tsdown)
npm run typecheck  # both programs
npm test           # vitest
```

测试针对真实的 DSH 存储层和真实的 SQLite backend 运行，并对符号链接投影使用真实文件系统，而不是 mock 这些契约。当前行为的规范位于 `openspec/specs/`（`dsh-pet`、`pet-lark-channel`、`pet-locus-collaboration`、`pet-locus-media-access`、`pet-workspace-env`、`pet-top-layer`）；设计决策见本 package 的 [`docs/adr/`](docs/adr/ADR-0001-executor-preset.md) 以及仓库级的 [ADR](../../docs/adr/ADR-0004-consolidate-locus-specs-into-pet-locus-collaboration.md)。

## 许可证

MIT

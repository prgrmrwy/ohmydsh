# Pet 统一 locus 协作模型

## Why

研发需要把自己的工作上下文与代码工作空间接入飞书协作现场；也需要从 project 群出发，在资料与讨论逐渐积累时建立同样的工作上下文。现有的“QA 子代理 / 普通群 workspace executor”分叉围绕实现组织概念，无法用同一条主干解释这两种起点及群内话题协作。

## 核心模型与阅读入口

**主会话承载研发工作的共同基础，locus 关联一个飞书协作入口，每个 locus 由主会话下的专属子会话持续处理。**

Locus 不是第三种 Agent，而是完整的协作关联：飞书入口、workspace 归属、主会话、子会话、权限和生命周期。入口 `(chatId, threadId?)` 用于精确寻址；主/子会话用于反向发现，不全部拼入寻址 key。Subagent 只作为 DSH 创建和运行子会话的技术术语。

```text
研发先行：已有主会话 ── Q&A / bind ──┐
                                    ├── locus ── 专属子会话 ── 飞书交互
协作先行：project 群 ── 自动主会话 ──┘
                           default workspace

同一主会话
  ├─ 子会话 A ↔ project 群 locus
  ├─ 子会话 B ↔ 技术评审话题 locus
  └─ 子会话 C ↔ issue 群 locus
```

完整架构在 [design.md](design.md)：理念、领域模型、层级补齐、双向索引、统一流程、上下文、权限、生命周期、一致性、升级与验收。本文与新设计从已确认产品模型建立，不继承旧草案 `pet-locus-multi-binding` 的架构或任务清单。

## 本期边界与未来方向

本期聚焦研发个人的**工作现场 ↔ 协作现场关联**，提高已有上下文的利用率，不建设 project 级上下文统合系统。主会话提供初始上下文和工作归属，**不自动维护项目全局最新认知，也不因父子关系天然成为统合者**。

双向发现、持续历史与来源引用是后续协同的基础；用户可以按需发起查阅和汇总，但索引可发现不代表已具备全部历史读取能力，也不等于信息已被采纳。相关宿主读取能力需核验。

未来可发展为多人各自的工作现场通过 project 串联、共同建设项目知识：显式分享与采纳、来源追踪、冲突处理、可选统合角色。这是独立后续方向，不要求把所有人的会话挂进同一棵父子树；本期不预建 Project/Summary 表、跨现场同步协议或自动汇总接口。详见 design §7.1–7.3。

## What Changes

- **BREAKING** 所有飞书工作统一为“确保主会话 → 建立 locus → 专属子会话 → 常规多轮交互”；移除飞书专用 root executor / Invocation 路径，不影响普通 Pet 轮盘能力的 Invocation/Snapshot。
- **BREAKING** 不兼容、不迁移旧关联。新版不消费旧绑定；保留旧 session、历史和飞书群，不把 breaking change 当作删除授权。
- 两种起点同构：已有研发主会话可向多个群/话题建立关联；project 群可在 default workspace 自动创建并复用一个群级主会话。本期不建设群级 workspace 覆盖配置。
- 话题创建先补齐群级结构，默认取得群的主会话；显式话题绑定可指定另一个主会话。执行树保持两层，话题子会话与群子会话是兄弟。
- locus 精确查找与幂等创建；提供主会话 → 全部 locus、子会话 → 所属 locus 的双向发现。
- Q&A 首次创建默认答疑群，以后打开同一个默认入口；其它群绑定不改变该默认值。
- 显式 `/bind S1` 可在空闲时替换自动关联 S0；当前入口必须提示来源从 S0 切换到 S1、上下文改变且旧历史未自动合并。既有话题不自动改绑，新话题继承新的群主会话。
- 仅 `@bot` 消息触发工作；bot 入群只建立关联，不推理历史。决策通过飞书消息往返，使用同一子会话后续轮次，不新增 waiting-user 执行机器。
- 所有新 locus 默认 read；仅 allowlist 可用 `-s/--scope read|write` 改变该 locus 的共享档位，绑定和授权分开。
- 子会话继承主会话已完成的可用前缀，必要时问主会话工作目录与约束；caller-bound `pet_context` 保存/提供已确认锚点与当前关联，不每轮重复整段上下文，也不自动汇总回传主会话。

## Capabilities

### New Capabilities

- `pet-locus-collaboration`: 完整统一协作模型，包括创建入口、主会话解析、层级补齐、双向发现、对话与切换、权限、上下文、退出及旧关联隔离。

### Modified Capabilities

- `pet-qa-group`: 撤销原 QA 独立模型要求；其产品入口与保留的安全约束由统一协作规范接替。
- `pet-lark-channel`: 保留 bot/profile/凭据与 channel 生命周期边界；替换旧准入、workspace 路由、Invocation 派发及反馈规范，更新 onboarding 到统一子会话流程。
- `dsh-pet`: scoped context 覆盖统一协作子会话；普通轮盘 root executor 的 Invocation/Snapshot 和 Skill 边界不变。

## Impact

- Host：channel 接入/解析、locus 控制器与持久索引、主会话初始化、子会话创建恢复、消息关联与结算、权限适配、context 工具。
- Web：按主会话与按飞书入口的双向管理视图、默认 Q&A、来源切换警告、初始化/失效/权限诊断。
- 数据：新模型独立版本，旧关联只作不可用历史；无旧关联转换器、无双执行兼容分支。
- DSH 集成：复用 continuable 子会话接缝，必须验证首次 fork/冷恢复、零业务历史的自动主会话、真实 sandbox 策略、子会话结算与父通知。不把旧 spike 的类型/README 检查当作端到端验证。Pet 临时依赖的宿主补丁由自身 customization 声明为版本锁定、仅长期 Web Host 生效的 compatibility runtime；一次性官方 CLI 不受影响，未来 DSH 版本不得自动继承旧补丁。
- 飞书：增加入群生命周期接入；保留现有 bot 凭据零接触。无法证明初始化授权的入群事件不授予群级提问资格，首次 allowlist `@bot` 可幂等补齐。
- 本变更仅规划；实际写入权限的宿主适配需能力核验，不假定 `workspace-write` 能写到 sw 兄弟目录，也不隐式采用 unrestricted 模式。

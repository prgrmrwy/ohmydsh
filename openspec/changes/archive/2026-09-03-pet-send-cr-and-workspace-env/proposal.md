## Why

Pet 骨架（Task/Invocation/快照/allowlist/投影）已完整，但目前没有一个真正可用的
Pet 能力形态被验证过：`packages/dsh-pet/skills/examples/` 下三个都是**示例**，无代码
消费；`builtinsInitialized` 字段定义了却无任何消费方；Settings 实际只有三个页签，
Bindings 位置是占位文案。

一期要证明的是一件事：**Pet 只是普通 DSH Skill 的又一个消费方**——不存在"为 Pet
适配过的 Skill"，因此也不存在内置与外置之分。当前 Pet 恰恰违背了这点：它解析
`SKILL.md` 中的 `petLabel`/`petIcon`/`petContext`，让 Skill 有了"为 Pet 优化"的
余地，并据此施加上下文门禁。这套机制应当移除。

移除之后，现有 `skills/ws` 无需任何改动即可被 Pet 消费，一期只需再补一个同等角色
的 `skills/send-cr`，并解决它唯一缺的东西：**按 workspace 配置、能安全送达执行
环境的 CR 目标群**。

## What Changes

- **移除 Skill 为 Pet 适配的机制**：删除 `SKILL.md` 中 `petLabel`/`petIcon`/
  `petContext` 的解析与持久化，以及由其驱动的 `contextRequirement` 链路（轮盘置灰、
  capture 预校验）。Pet 呈现能力时只用 Skill 名与 description；来源是否满足由 Skill
  自己在执行时校验。**BREAKING（内部）**：`PetCapability.contextRequirement` 与
  `PetSkillRevision.pet` 移除。
- **移除 create-mr**：`packages/dsh-pet/skills/examples/create-mr/` 删除。它只是示例，
  内部工具契约未定，一期不需要。
- 新增 `skills/send-cr/`（仓库级普通 Skill，与 `skills/ws` 同等角色），随 sync 部署到
  `~/.dsh/skills/send-cr`，可独立使用、也可被 Pet 导入消费。
- Pet 新增**环境变量**配置，分**全局**与**来源 workspace** 两个作用域：用户配
  `CR_GROUP=oc_xxx`，Pet 经 DSH 官方 `ctx.shellEnv` 注册为 `DSH_PET_CR_GROUP`，
  每次 bash 调用自动注入执行环境。全局对所有 Pet Task 生效，workspace 配置覆盖
  同名全局项，两者皆无则该变量不存在、由 Skill 停下来询问。Skill 里就是普通
  `$DSH_PET_CR_GROUP`，**无自定义模板语法、值不经过 prompt**。
- Pet Settings 新增**「环境变量」页签**（第四个稳定页签，取代原 Bindings 占位）：
  全局区域 + workspace 区域，各自编辑 key-value，并标示覆盖关系。
- **修复 Pet 被右侧栏顶走**：Pet 改为挂载到 `document.body` 下的自有宿主节点并
  建立**独立 React root**，脱离 `#root` 的布局挤压，成为真正的顶层浮层。
- **BREAKING（内部）**：Pet domain 版本 2 → 3（新增 env 表，纯增表）。

## Capabilities

### New Capabilities

- `pet-workspace-env`: Pet 按全局与来源 workspace 两个作用域持久保存环境变量键值、
  以 workspace 覆盖全局的顺序经官方 `ctx.shellEnv` 以 `DSH_PET_*` 注入 executor 的
  每次 shell 调用，以及「环境变量」设置页签。
- `pet-top-layer`: Pet 作为不为任何布局让位的顶层浮层：独立挂载点与独立 React
  root、视口坐标系定位、以及交互与拖拽状态在挂载方式变更后仍完好的保证。
- `send-cr-skill`: 仓库级普通 Send CR Skill，消费 `pet_context` 快照与注入的
  `$DSH_PET_*`，经 lark-cli 发送结构化 CR 消息，发送前必须用户确认。

### Modified Capabilities

- `dsh-pet`: ① 一期能力集合从「Create MR / Send CR / Clean Worktree 三项内置」修正
  为「由用户导入的普通 Skill 提供，一期验证 ws 与 send-cr 两项」；② 系统 MUST NOT
  提供任何让 Skill 为 Pet 适配的机制；③ 来源上下文不再按能力施加门禁，改由 Skill
  自行校验；④ 设置页第四页签定为「环境变量」。

## Impact

- 删除 `packages/dsh-pet/skills/examples/create-mr/`。
- `packages/dsh-pet/src/host/skill-bundle.ts`：移除 `petLabel`/`petIcon`/`petContext`
  解析与 `normalizeContext`。
- `packages/dsh-pet/src/host/capabilities.ts`：移除 `contextRequirement` 投影。
- `packages/dsh-pet/src/host/capture.ts`：移除 `requirement` 参数与预校验分支。
- `packages/dsh-pet/src/client/overlay.tsx`：移除轮盘上下文置灰分支。
- `packages/dsh-pet/src/wire.ts`：移除 `PetContextRequirement`、
  `PetCapability.contextRequirement`、`PetSkillRevision.pet`。
- `packages/dsh-pet/src/host/spec.ts`：移除 `pet` 字段、新增 env 表 + 版本 3 + migrate。
- `packages/dsh-pet/src/host/repository.ts`：env CRUD。
- `packages/dsh-pet/src/index.ts`：注册 `ctx.shellEnv` contributor（新增 `shellEnv`
  inject 与 `cordis.patch.yml` inject 行）。
- `packages/dsh-pet/src/host/routes.ts` / `wire.ts` / `client/api.ts`：env 管理路由。
- `packages/dsh-pet/src/client/settings.tsx`：新增「环境变量」页签。
- 新增 `skills/send-cr/SKILL.md` + `dsh.yaml` skill 条目。
- `packages/dsh-pet/src/client/index.tsx`：Pet 浮层从 `shell.overlay` 槽改为
  `document.body` 下自有宿主 + 独立 `createRoot`（settings section 注册不变）。
- `packages/dsh-pet/src/client/styles.ts`：`.dshpet-root` 从 `position:absolute`
  改为 `position:fixed`，z-index 提升至顶层区间。
- 测试：`packages/dsh-pet/test/`（env 存储、shellEnv 注入解析、路由校验、页签、
  挂载与交互回归）。
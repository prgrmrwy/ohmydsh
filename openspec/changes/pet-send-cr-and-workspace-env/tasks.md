## 1. 移除 Skill 为 Pet 适配的机制

- [x] 1.1 `src/host/skill-bundle.ts`：移除 `SkillFrontmatter` 的 `petLabel`/
      `petIcon`/`petContext`、`normalizeContext()`、`BundleInspection.pet`，以及
      `inspectBundle()` 中的 pet 组装分支
- [x] 1.2 `src/wire.ts`：移除 `PetContextRequirement` 类型、
      `PetCapability.contextRequirement`、`PetSkillRevision.pet`（`icon` 同去，
      它同样只能来自 `petIcon`）
- [x] 1.3 `src/host/spec.ts`：从 `petSkillRevision` schema 移除 `pet` 字段
- [x] 1.4 `src/host/capabilities.ts`：移除 `CapabilityDeclaration.contextRequirement`
      与 `project()` 中的 context 推导，label 直接取 skillName
- [x] 1.5 `src/host/capture.ts`：`validateCapture()` 移除 `requirement` 参数及两处
      `CONTEXT_REQUIRED` 预校验分支
- [x] 1.6 `src/host/coordinator.ts`：移除向 `validateCapture` 传 `contextRequirement`
- [x] 1.7 `src/host/routes.ts`：skillImport 不再写入 `pet` 字段
- [x] 1.8 `src/client/overlay.tsx`：`blocked()` 移除两个上下文分支，仅保留
      `available`/`diagnostic` 判断
- [x] 1.9 删除 `packages/dsh-pet/skills/` 整个目录，并从 `package.json` 的 `files`
      数组移除 `"skills"`
- [x] 1.10 修正受影响的既有测试（`skill-bundle.test.ts`、`loader-composition.test.ts`、
      `coordinator.test.ts`、`capture.test.ts`、`harness.ts`）中对 pet 字段/上下文
      门禁的断言
- [x] 1.11 新增测试：不含任何 pet 字段的 Skill 导入后正常成为能力，label 为 skill 名
      （并断言 plain 与含 pet 字段的 Skill 检查结果完全等价）
- [x] 1.12 新增测试：`none` 来源下任意能力都可创建 Invocation，不再抛 `CONTEXT_REQUIRED`
      （已用变异测试验证该断言真的会失败）

## 2. 环境变量持久化

- [x] 2.1 `src/host/spec.ts`：新增 `petEnvEntry` schema（`scope`/`key`/`value`/
      `updatedAt`）与 `workspace_env` 表；key 校验 `^[A-Z][A-Z0-9_]*$`；
      导出 `PET_ENV_GLOBAL_SCOPE` 与 `envKey()` 复合键
- [x] 2.2 `src/host/spec.ts`：从 `petGlobalState` 移除 `builtinsInitialized`
- [x] 2.3 `PET_DOMAIN_VERSION` bump 到 3，注释说明本次为增表 + 字段清理
- [x] 2.4 `src/host/migrate.ts`：确认 v2 → v3 不清表；残留 `pet` 键由 zod 读回时
      自然剥离。**发现并修复缺陷**：版本重刻原本以 `removedRows > 0` 为条件，
      导致健康 v2 库不会被重刻 → 下次 open 因版本不符拒绝、Pet degraded。
      已改为无条件重刻（探针复现 + 回归测试固化）
- [x] 2.5 `src/host/repository.ts`：实现 `listEnvEntries()`、
      `listEnvEntriesByScope(scope)`、`getEnvEntry()`、`putEnvEntry()`、
      `deleteEnvEntry()`，以及集中优先级合并的 `resolveEnvFor(workspaceId)`
- [x] 2.6 测试：写入/同 scope 同 key 覆盖/按 scope 列出/删除/非法 key 拒绝/
      空 value 拒绝/重启后仍在
- [x] 2.7 测试：全局与 workspace 同名 key 是两条独立记录，互不覆盖；并覆盖
      覆盖/回退/合并/无 workspace/跨 workspace 隔离/皆无则为空
- [x] 2.8 测试：含旧 `pet` 字段的 v2 记录升级到 v3 后仍可读，且 Task/Skill 行保留

## 3. shellEnv 注入

- [x] 3.1 `package.json` 增加 `@deepseek-ai/dsh-shell-env` 到 devDependencies。
      **修正计划**：不加 peerDependencies、不加 cordis.patch.yml inject——探针证实
      cordis 对 inject 服务是必需依赖语义，声明后 Host 缺该服务时 Pet 永不加载，
      与 spec 要求的「降级为不注入」矛盾
- [x] 3.2 **修正计划**：`inject` 数组不加 `'shellEnv'`，改用 `ctx.get('shellEnv')`。
      探针证实直接读 `ctx.shellEnv` 会抛 `cannot get property "shellEnv" without
      inject`，而 `ctx.get()` 对缺失服务安全返回 `undefined`
- [x] 3.3 新增 `src/host/shell-env.ts`：导出 `PET_ENV_PREFIX = 'DSH_PET_'` 与
      `createPetEnvContributor(repository)`，`resolve(execution)` 从
      `execution.agent?.session.header.id` 反查 Task → 当前 Invocation → 快照
      `sourceWorkspaceId`；**先铺 `global` 作用域、再用该 workspace 作用域覆盖
      同名 key**，最后统一加前缀返回
- [x] 3.3 新增 `src/host/shell-env.ts`（见下方 3.4 的声明策略）
- [x] 3.4 **已查证**：`collect()` 对未声明 key **抛错并中断该次 shell 调用**，
      非仅告警；但 registry 持有 contributor 对象引用、每次 collect 重读
      `variables`。故实现为：`resolve()` 内先按当前配置**原地重建**声明再返回值，
      两者天然一致，不可能返回未声明 key。key 全带 `DSH_PET_` 前缀，独占命名空间，
      不触发 `keyOwners` 冲突。（无需两层方案）
- [x] 3.5 `src/index.ts` 用 `ctx.effect()` 注册 contributor，`ctx.get('shellEnv')`
      为空时记日志降级，不 degraded
- [x] 3.6 测试：workspace 覆盖全局、缺 key 时回退全局、两作用域合并、独立任务
      只拿全局、两者皆无则变量缺失、非 Pet 会话/无 agent/无当前 Invocation 返回空
- [x] 3.7 测试：两个不同 workspace 并发时各自 workspace 变量互不可见
- [x] 3.8 测试：注入值不出现在 envelope 文本中；另补声明一致性、删除后不留幻影、
      注册后新增 key 仍生效三项

## 4. 管理路由与设置页签

- [x] 4.1 `src/wire.ts`：新增 `ROUTES.petEnv` / `petEnvMutate`，导出
      `PetEnvRecord`（含 `scope` 字段）与 `PET_ENV_GLOBAL_SCOPE = 'global'`
- [x] 4.2 `src/host/routes.ts`：新增列表/写入/删除路由，复用 `strictBody`/
      `petRoute`/`requireReady`；请求以显式 `scope` 区分作用域，缺 `scope`/`key`
      或 scope 形状非法返回 `BINDING_INVALID`；显式拒绝把 `global` 当 workspace id
- [x] 4.3 列表路由同时返回全局与各 workspace 记录（供 UI 标示覆盖关系），并返回
      workspace 候选（id + title），经 `RouteDeps.listWorkspaces?()` 注入，由
      `src/index.ts` 用 `ctx.workspaceRegistry.list()` 提供
- [x] 4.4 `src/client/api.ts`：新增 `petEnv()` / `mutatePetEnv()`
- [x] 4.5 `src/client/settings.tsx`：`PET_SETTINGS_TABS` 扩为四项（新增 `env`），
      标签文案「环境变量」
- [x] 4.6 实现面板三区域（视觉参考 `design-notes/env-tab-mockup.html`）：**全局**（无需选
      workspace 即可编辑）、**工作区**（枚举选择显示标题+路径，允许手工输入 id）、
      **生效结果**（只读）；前两区各自键值列表增删改，每行显示注入名
      `$DSH_PET_<KEY>`，失败保留输入并指出无效字段
- [x] 4.7 工作区区域标示覆盖关系：与全局同名的 key 标出"覆盖全局"
- [x] 4.8 生效结果区域：展示合并后实际生效项并标注来源（全局/工作区），被覆盖的
      全局项一并列出并标示"已被覆盖"，不静默隐藏
- [x] 4.9 值默认打码 + 逐项显示/隐藏切换；遮挡仅在渲染层，不改变存储与注入
- [x] 4.10 文案：说明优先级（workspace 覆盖全局、皆无则 Skill 停止）、值会进入
      子进程环境、不适合存高敏凭据、安全性由用户自负；替换原「渠道」占位段落
- [x] 4.11 测试：新增 `test/env-tab.test.ts` 覆盖全局区域独立保存、workspace 区域
      保存、覆盖标示、生效结果的来源标注与被覆盖项、打码与切换、保存失败保留输入
- [x] 4.12 测试：`test/route-validation.test.ts` 补 `BINDING_INVALID` 用例
      （缺 scope / 缺 key / scope 非法）

## 5. send-cr Skill

- [x] 5.1 新建 `skills/send-cr/SKILL.md`，frontmatter 只含 `name`/`description`/
      `whenToUse`（无任何 pet 字段）
- [x] 5.2 正文：执行开始先调 `pet_context`（Pet 中运行时）确认来源；从
      `$DSH_PET_CR_GROUP` 取目标群，缺失则停止并指引到 Pet 设置「环境变量」页
- [x] 5.3 正文：确定 MR 链接（用户提供或前序产出，缺失则询问，不编造）
- [x] 5.4 正文：发送前展示完整消息与目标群，等待用户明确确认
- [x] 5.5 发送命令：`lark-cli im +messages-send --json --chat-id <oc_...>
      --text <msg> --idempotency-key <invocation id 派生, ≤50 字符>`
- [x] 5.6 正文：结构化消息模板；失败如实报告、不换目标重试；lark-cli 缺失时停止；
      完成不等于结束 Pet Task
- [x] 5.7 `dsh.yaml` 新增 `- id: send-cr / type: skill / enabled: true` 条目及中文注释

## 6. Pet 顶层浮层（不被侧栏顶走）

- [x] 6.1 `src/client/index.tsx`：移除 `ctx.slots.inject('shell.overlay', …)` 的
      Pet 浮层注册（settings.section 注册保持不变）
- [x] 6.2 新增挂载逻辑：`ctx.effect()` 中创建带稳定标识（`data-dsh-pet-host`）的
      宿主 div，`document.body.appendChild`，`createRoot(host)` 渲染
      `PetOverlaySurface`；挂载前先按该标识检测并复用，避免 HMR/重载重复挂载
- [x] 6.3 清理函数：`root.unmount()` + 移除宿主节点，确保无节点与监听器泄漏
- [x] 6.4 `PetOverlaySurface` 保持模块作用域声明（勿改为内联组件），维持组件标识
      稳定，避免重挂载丢失拖拽位置与面板状态
- [x] 6.5 `src/client/styles.ts`：`.dshpet-root` 由 `position:absolute` 改为
      `position:fixed`，z-index 提升到高于应用内容的区间；更新该处解释注释
      （原注释称"留在 overlay 层"，需改写为独立 root 的理由）
- [x] 6.6 宿主节点 `pointer-events:none`、Pet 自身表面 `auto`，保持未绘制区域
      不拦截底层页面指针事件
- [x] 6.7 **发现并修正**：`useViewport()` 原本测量 `[data-shell-overlay]`，该层随
      侧栏收缩——继续用它钳制会把 Pet 限制在侧栏左侧。已改为纯视口
      （`innerWidth/Height`），并移除随之无用的 ResizeObserver
- [x] 6.8 测试：挂载创建宿主节点、卸载后节点被移除且 root 已 unmount、重复
      apply 不产生第二个宿主节点
- [x] 6.9 **实机验证**：用户确认展开/收起 better-sidebar 右侧工作台、拖拽调宽全程，
      Pet 位置不变、不被裁剪
- [x] 6.10 **实机验证交互四项**：用户确认 hover 展开轮盘、拖拽移动 Pet、点击扇区执行、
      点击本体开面板全部正常（独立 React root 未破坏事件委托）
- [x] 6.11 实机验证：随上述验收一并确认，未见配色异常

## 7. 验证与收尾

- [x] 7.1 `cd packages/dsh-pet && npm run typecheck && npm test`
- [x] 7.2 仓库级 `npm test` 与 `npm run check:artifacts`
- [x] 7.3 `node scripts/sync.mjs` 连续两次，第二次无变化；确认
      `~/.dsh/skills/send-cr` 已部署
- [x] 7.4 实机验证 A：`ws` 未做任何改动即作为 Pet 能力出现并成功执行
- [x] 7.5 实机验证 B：send-cr 端到端跑通并真实发送（message_id
      om_x100b66a8f21374a4ddc1f210e024688）。workspace 作用域注入生效。
      **未覆盖**：全局回退、两处皆空时停下询问——留待后续验证
- [x] 7.6 实机验证 C：Agent 先 dry-run 校验、展示目标群与全文并等待确认后才发送
- [x] 7.7 更新 `dsh.yaml` 中 dsh-pet 条目 note：能力形态、环境变量机制、顶层浮层挂载、
      shellEnv 可选依赖与注册陷阱均已写入
- [x] 7.8 记录回滚约束：domain v3 单向升级（已在 design.md 与 spec.ts 注释中记录）
## 8. 实施中发现并修复的缺陷（非原计划）

- [x] 8.1 `migrate.ts` 版本重刻原本条件为 `removedRows > 0`，导致健康 v2 库不重刻 →
      下次 open 因版本不符拒绝、Pet degraded。改为无条件重刻，配 2 条回归测试
- [x] 8.2 `shellEnv.register` 原本包在 `ctx.effect` 内，effect 重跑导致重复注册抛错，
      中断 Pet 初始化并使 executor 丢失 bash/fs 等官方工具（只剩 5 个工具）。
      改为直接调用 + try/catch 兜底，配 2 条回归测试
- [x] 8.3 send-cr skill 的 session 解压脚本用单帧 `zstdDecompressSync`，在多帧 zstd
      上只解出 session 头（实测 2.1MB 文件仅出 189 字节），会稳定漏检 MR。
      改为按 magic number 逐帧解压，并加解压字符数自检
- [x] 8.4 send-cr skill 原从 `mr get` 读 reviewer，但该字段恒为 null。
      改用 `mr reviewer list`，并要求排除 `Type: app` 的机器人

## 9. 合入主干后的一次性收尾

- [ ] 9.1 在 Pet 设置 → Skill 里**移除** send-cr 的现有注册（指向
      `~/.dsh/skills/send-cr` 的部署副本），改为从
      `/Users/prgrmrwy/opensource/ohmydsh/skills/send-cr` 重新导入并启用。
      合入前主干没有该目录，只能先指部署副本；合入后应与 `ws` 一致地指向仓库
      源码，使 SKILL.md 的改动无需 sync 即刻生效
- [ ] 9.2 可选清理：`~/.dsh/plugins/dsh-pet/skills/store/` 下 clean-worktree /
      create-mr / send-cr 三个目录是旧 content-addressed 模型的孤儿数据，
      当前无任何注册引用它们，可直接删除

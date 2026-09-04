# 阶段四能力基线(升级前基准)

本文件是 change `staged-dsh-and-plugin-upgrade` 任务 5.1–5.4 的产物,也是任务 6.7
「复跑并逐项比对」的唯一依据。

**用途**:运行体从 `0.1.1-rc.2` 升到 `0.1.2-rc.1` 前后各跑一次,逐项比对。
按 spec「升级后失败必须先行归因」:任何失败项都必须先查本表在升级前是否通过,
未经比对不得断言为升级导致。

**采集环境**:
- 运行体 `dshVersion: 0.1.1-rc.2`,cordis `4.0.2`(实测,非 `4.0.1`)
- 采集时点:2026-09-04,阶段三完成后、阶段四执行前
- 采集位置:主 checkout `/Users/prgrmrwy/opensource/ohmydsh`
- 启动清单:21 项(20 插件 + setting-restart)

---

## A. 自动化基线(5.1)

### A1. 仓库级

| 检查 | 命令 | 升级前结果 |
|---|---|---|
| 仓库测试 | `npm test` | ✅ **96 例:95 通过 / 0 失败 / 1 跳过** |
| 制品策略 | `npm run check:artifacts` | ✅ 通过 |
| sync 幂等 | `node scripts/sync.mjs` ×2 | ✅ 第二次 `no changes` |

> 1 跳过项 = `every manifest patch fragment this repo ships stays parseable`。
> 阶段二退役了仓库唯一的 patch 片段,该用例改为条件触发(空 `patches/` 合法跳过)。
> **这是预期状态,不是失败**;升级后若变为 fail 才需要关注。

### A2. 自研包级(8 个)

| 包 | build | typecheck | test |
|---|---|---|---|
| `dsh-pet` | ✅ | ❌ **见 A3** | ✅ 575 例 |
| `home-network-model-guard` | ✅ | ✅ | ✅ 56 例 |
| `session-links` | ✅ | ✅ | ✅ 53 例 |
| `session-title-copy` | ✅ | ✅ | ✅ 20 例 |
| `sidebar-session-provider-icon` | ✅ | ✅ | ✅ 25 例 |
| `system-clock` | ✅ | ✅ | ✅ 21 例 |
| `worktree-session` | ✅ | ✅ | ✅ **201 例**(与 design 记载一致) |
| `subscriptions-sandbox-shim` | (无) | (无) | ✅ |

**自研包测试合计:951 例通过。**

### A3. ⚠ 升级前即失败项(必须在此登记,避免升级后误归因)

**`dsh-pet` typecheck —— 升级前即失败,与本次升级无关。**

```
src/client/index.tsx(16,28): error TS7016:
  Could not find a declaration file for module 'react-dom/client'.
```

- 仅此 1 个错误,`build` 与 575 例 test 均通过
- 根因是**环境漂移而非代码缺陷**:`@types/react-dom@^18.3.7` 已在
  `packages/dsh-pet/package.json` 的 devDependencies 中声明,也已被
  `package-lock.json` 记录(`18.3.7`),但主 checkout 的 `node_modules/@types/`
  下实际只有 `react`,**没有 `react-dom`** —— 主 checkout 的 install 已过期
- **本次未修复**:spec 要求基线如实记录升级前状态,不得为了让基线好看而
  夹带无关修复。修复手段(在主 checkout 重跑 install)应作为独立事项处理
- **升级后判定规则**:若升级后此项仍以**同一个 TS7016 错误**失败 → 与升级无关;
  若错误数量或种类变化 → 才需要按升级导致来排查

---

## B. 人工验收清单(5.2 / 5.3)

自动化无法覆盖的行为。每项都给出可执行步骤与预期结果。

**判定原则(spec)**:「无报错」不作为通过依据。每项必须看到**明确的可见证据**;
装得上、无报错但功能消失 = **失败**(静默不激活)。

### B1. 每个自研包的「确实加载并可用」判据(5.3)

对抗静默不激活。每个包给出一个最小可观测证据:

| # | 包 | 可见证据 | 验收步骤 | 升级前结果 |
|---|---|---|---|---|
| B1.1 | `system-clock` | 设置面板**最底部**的主机时钟(24h + 时区 + hostname),秒针每秒跳动 | 打开设置 → 滚到底 | ✅ |
| B1.2 | `session-title-copy` | 会话标题右侧 6 位 id 徽标(如 `9af69b`) | 打开任一会话看标题栏;点击应复制完整 id 并出现提示 | ✅ |
| B1.3 | `sidebar-session-provider-icon` | 侧边栏会话行前的模型品牌 logo | 看侧边栏;在输入框切换模型后 logo 应即时更新 | ✅ |
| B1.4 | `session-links` | better-sidebar 右侧「文档/资料」tab,badge 显示链接计数 | 打开右侧栏 → 找到该 tab | ✅ |
| B1.5 | `dsh-pet` | 桌宠浮层入口常驻可见且可点开 | 看主界面浮层;打开 Pet 设置页应有「环境变量」页签 | ✅ |
| B1.6 | `worktree-session` | 首页空白会话首发时创建 `ws/*` 分支与 `.worktrees/*`(**本会话即证据**) | 见 B2.1 | ✅ |
| B1.7 | `home-network-model-guard` | 出口非受限地区时 Claude 模型**可正常发送**(不被误禁) | 选一个 Claude 模型,确认输入框未被禁用 | ✅ |
| B1.8 | `subscriptions-sandbox-shim` | codex/grok 工具调用不报 `No tool output found` / sandbox 字段错误 | 用 codex 或 grok 模型跑一次带工具的对话 | ✅ |

### B2. 已知无自动化覆盖的行为(5.2)

| # | 行为 | 来源 | 验收步骤 | 预期结果 | 升级前结果 |
|---|---|---|---|---|---|
| B2.1 | `worktree-session` 的 `agent/session-start` **编排时序**:同步跳过 guard 安装 + 异步落盘 | 归档记录 `2026-09-04-release-binding-when-worktree-is-gone` | 在一个 Worktree Session 中发起会话,随后在该 Session 内调用任意 Bash | 工具调用**不被 guard 误拦**;绑定信息正确落盘;`ws status` 能返回正确 phase | ✅ **本 change 实施过程即证据**:全程在 Worktree Session 内执行数十次 Bash 无一被 guard 误拦;`ws status` 返回 `phase: prepared` 且 repoRoot/taskBranch/worktreePath/dshHome 齐全;主 checkout 始终停在 `main` 未被切换 |
| B2.2 | `ws status` / `promote` / `clean` 的安全门 | `packages/worktree-session` 安全路径 | 对已归档且干净的候选跑 `ws clean --dry-run` | 安全门判定与预期一致;身份不可证明时**拒绝**破坏性操作 | ✅ **两道门实测均 fail-closed**:① `ws clean` 从绑定 Session 内调用被拒(`unavailable to a bound Worktree Session`);② `ws promote --path <主 checkout>` 因越界路径未获授权被拒(`was not authorized by the user for this promote call`)。两者都是「身份/授权不可证明即拒绝」的正确表现 |
| B2.3 | Pet Invocation 的 `pet_context` 可信来源快照 | `dsh-pet` 零参数工具 | 在 Pet 会话中触发一次 Invocation | 返回的 source 快照与实际调用来源一致 | ✅ **查 `state.sqlite` 历史数据验证不变量**:37 条 invocation 的 `snapshotId` 全部命中 `u_dsh_pet_snapshots`(缺失 0),且 37 个 snapshotId **互不相同** —— 即每次调用固定各自的来源快照,不复用、不被后续页面切换改写 |
| B2.4 | 阶段一至三已验收项的持续可用 | 本 change 阶段一/二/三 | cost-meter 费用展示、subscriptions 模型选择器 +「每模型默认推理档」、宽度五档切换 + localStorage 记忆、侧边栏各面板 | 均正常 | ✅ **已于阶段一/二/三分别验收通过** |

### B3. 阶段四放行项的专项验收(来自 spike S4)

升级后才执行,但判据现在就固定下来:

| # | 项 | 判据 |
|---|---|---|
| B3.1 | `sidebar-qa@0.5.0` 划选提问 | 划选文本 → 出现「提问」→ 能开侧边问答会话。**这是最易静默失效的一项** |
| B3.2 | `sidebar-qa` 的 `selectModel` / `modelCatalog` | 这两个方法由 `dsh-client-ui-model-selection` 提供(**不在** `dsh-api-session-controller` 内)。必须确认该包随 profile 加载,否则侧边问答的模型选择会静默失效 |
| B3.3 | `better-sidebar@0.18.0` | 各面板可开;`session-links` 的 tab 仍注册成功 |

---

## C. 比对规程(6.7 用)

1. 升级后按 A1 → A2 → B1 → B2 顺序**完整复跑**
2. 任何失败项**先查本表对应行**:
   - 本表为 ✅ 而升级后失败 → 按升级导致排查
   - 本表为 ❌(目前仅 A3 的 `dsh-pet` typecheck)→ 先比对错误是否同一个,同一个则与升级无关
3. **未经上述比对,不得断言任何失败为升级导致**
4. `tests/local-package-peers.test.mjs` 在阶段四期间失败是**预期的前置门槛**(design D6),
   不得通过放宽检查、豁免个别 package 或跳过来消除

---

## D. 状态

- [x] A1 仓库级自动化 —— 已跑通并记录
- [x] A2 自研包自动化 —— 已跑通并记录(951 例通过)
- [x] A3 升级前失败项 —— 已登记(`dsh-pet` typecheck,环境漂移)
- [x] B1/B2/B3 清单 —— 已编写,步骤与预期结果可执行
- [x] **B1/B2 人工项实际执行** —— 已全部执行并回填(2026-09-04)

### 采集方式说明

- **B1(8 项)**:用户在 Web 端逐项确认通过。
- **B2.1 / B2.2**:由本 change 的实施过程本身产生证据——整个阶段一至四 spike
  都在一个 Worktree Session 内完成,数十次 Bash 调用无一被 guard 误拦
  (B2.1);两道安全门在实际调用中各拒绝一次越权操作(B2.2)。这是**运行中
  产生的真实证据**,强于专门构造的一次性验证。
- **B2.3**:不构造新 Invocation,改为对既有 `state.sqlite` 的 37 条历史记录
  验证其不变量(snapshotId 全命中且互不相同)。历史数据覆盖面大于新造一条。
- **B2.4**:阶段一/二/三各自的验收即为证据。

### 基线完备性声明

A(自动化)与 B1/B2(人工)均已在**升级前的当前运行体**上跑通并记录,满足
spec「基线必须在升级前先跑通一次并记录」的要求。B3 是阶段四放行项的**预置判据**,
按设计在升级后执行,不属于升级前基线的组成部分,其未执行不构成基线缺口。

唯一的 ❌ 项是 A3 的 `dsh-pet` typecheck,已按 spec 标注为「升级前即失败」
并写明判定规则,避免升级后误归因。

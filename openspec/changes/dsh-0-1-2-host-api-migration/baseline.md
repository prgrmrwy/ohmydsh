# 本次迁移的能力基线(复用 + 专项补充)

本文件承接归档 change `2026-09-04-staged-dsh-and-plugin-upgrade` 的 `baseline.md`
(tasks 1.2 覆盖面确认 + 1.3 专项补充),是任务 4.1 复跑比对的依据。

## 覆盖面确认(1.2)

归档基线的 A(自动化)与 B(人工)清单覆盖了本次影响范围内的全部 8 个自研包与
21 项启动清单;本次破坏面(5 个破坏点)全部落在这 8 个包内,故覆盖面仍适用。
本次新增的破坏面专项验收见下文 E 节(1.3)。

## 升级前复跑记录(1.2,2026-09-05,隔离 Worktree Session)

**采集环境**:运行体 `0.1.1-rc.2`;采集位置为隔离 worktree
`.worktrees/openspec-apply-change-dsh-0-1-2-host-api-migrati`(mutable 依赖模式,
fresh `npm install`);隔离 `DSH_HOME=.git/ws/dsh-home/789cc35c-…`。

### A1 仓库级

| 检查 | 结果 | 与归档基线比对 |
|---|---|---|
| `npm test` | ✅ 96 例:95 通过 / 0 失败 / 1 跳过 | 一致 |
| `npm run check:artifacts` | ✅ 通过 | 一致 |
| 隔离 sync ×2 | ✅ 第二次 `no changes` | 一致(见附注) |

> 附注:隔离 home 首次物化需两处一次性环境准备,均为环境配置而非仓库行为:
> ① `profiles/web/.npmrc` 固定 `registry=https://registry.npmjs.org/`(本机
> `~/.npmrc` 指向 bnpm 内网源,公开包 404);② `pnpm-workspace.yaml` 的
> `allowBuilds.node-pty` 按主部署既有信任决定置 `true`。二者均只写隔离 home,
> 未触碰 `~/.dsh`。

### A2 自研包级(8 个)

| 包 | build | typecheck | test |
|---|---|---|---|
| `dsh-pet` | ✅ | ✅(见 A3 差异) | ✅ 575 例 |
| `home-network-model-guard` | ✅ | ✅ | ✅ 56 例 |
| `session-links` | ✅ | ✅ | ✅ 53 例 |
| `session-title-copy` | ✅ | ✅ | ✅ 20 例 |
| `sidebar-session-provider-icon` | ✅ | ✅ | ✅ 25 例 |
| `system-clock` | ✅ | ✅ | ✅ 21 例 |
| `worktree-session` | ✅ | ✅ | ✅ 201 例 |
| `subscriptions-sandbox-shim` | (无) | (无) | ✅ |

**自研包测试合计 951 例通过,与归档基线一致。**

### A3 与归档基线的已知差异

归档基线 A3 登记的 `dsh-pet` typecheck 失败(TS7016, `react-dom/client`)在本
环境**不复现**:根因是主 checkout 的 install 过期(`@types/react-dom` 未装),
本 worktree 为 fresh install 故通过。这与归档基线「环境漂移而非代码缺陷」的
归因一致,不构成基线差异。**升级后判定规则更新**:在本 worktree 内,此项应为
✅;若失败即为新增失败,需按升级导致排查。

## E. 本次破坏面专项验收(1.3)

按 design D4,新增三项。判定原则沿用归档基线:「无报错」不作为通过依据。

### E1. `authority` 回环边界(spec `settings-system-clock`「非回环来源访问 channel」)

- **步骤**:在隔离实例(升级后运行体)启动 `dsh web` 后:
  1. 回环正例:`curl` 以 `127.0.0.1` 来源调用 `/dsh-system-clock` RPC channel
     (按官方 connection RPC 的 HTTP 承载路径构造请求),预期返回时间采样;
  2. 非回环反例:改以本机局域网 IP(如 `en0` 地址)为目标地址发同一请求,
     并/或伪造非回环 `Origin`/`Host` 头,预期该请求**不被受理**(拒绝、404
     或连接失败均可,但不得返回采样数据)。
  3. 同法覆盖 `/dsh-home-network-model-guard` 与 `session-links` 的 channel
     (若其 channel 仅在特定时机注册,以 system-clock 为主证,其余两包确认
     采用同一注册机制即可)。
- **预期**:非回环来源拿不到业务数据;「编译通过/无报错」不算通过。
- **升级前状态**:`0.1.1-rc.2` 上由注册参数 `authority: 'loopback'` 表达,
  三包均传入;spec 场景在升级前成立。

### E2. `Session.events` 替代读取

- **dsh-pet 用法**(取标题与水位):触发一次 Pet Invocation 后,确认 Pet 侧
  能取到 executor 会话的标题与消息水位(设置页/浮层可见证据,或对应单测)。
- **worktree-session 用法**(判定 blank session):在隔离实例首页开启空白会话
  并首发,确认 blank 判定仍准确——首发创建 `ws/*` 分支,非空白会话不触发。
- **预期**:两包各自测试套件通过且行为语义与升级前一致;适配不得改变判定口径。

### E3. `registerContinuableSetup` 承接后的行为

- **步骤**:`worktree-session` 的 continuable subagent 建立策略经新 API 承接后,
  201 例测试全过;并在隔离实例实际发起一次 Worktree Session,确认
  `agent/session-start` 编排(同步跳过 guard 安装 + 异步落盘)与
  `ws status` phase 上报仍正确(归档基线 B2.1 同判据)。
- **预期**:时序语义不变;guard 不误拦;绑定信息完整落盘。

## 比对规程

沿用归档基线 C 节:升级后按 A1 → A2 → E 顺序复跑;任何失败先比对本文件
升级前记录再归因;`tests/local-package-peers.test.mjs` 在迁移批次内失败是
预期前置门槛,不得放宽。

---

## 升级后复跑记录(4.1,2026-09-05,同一隔离 worktree,运行体 `0.1.2-rc.1`)

### A1 仓库级

| 检查 | 升级前 | 升级后 | 判定 |
|---|---|---|---|
| `npm test` | ✅ 96:95 通过 / 1 跳过 | ✅ **96:95 通过 / 0 失败 / 1 跳过** | 一致(含 `local-package-peers` 重新通过) |
| `npm run check:artifacts` | ✅ | ✅ | 一致 |
| 隔离 sync ×2 | ✅ 第二次 `no changes` | ✅ 第二次 `no changes` | 一致(3.6 完成) |

### A2 自研包级(8 个)

| 包 | build | typecheck | test | 与升级前比对 |
|---|---|---|---|---|
| `dsh-pet` | ✅ | ✅ | ✅ 575 | 一致 |
| `home-network-model-guard` | ✅ | ✅ | ✅ 56 | 一致 |
| `session-links` | ✅ | ✅ | ✅ **54**(升级前 53) | +1:`produces` 测试按新词汇表重写后多一个 `str_replace_editor` 场景,非回归 |
| `session-title-copy` | ✅ | ✅ | ✅ 20 | 一致 |
| `sidebar-session-provider-icon` | ✅ | ✅ | ✅ 25 | 一致 |
| `system-clock` | ✅ | ✅ | ✅ 21 | 一致 |
| `worktree-session` | ✅ | ✅ | ✅ 201 | 一致 |
| `subscriptions-sandbox-shim` | (无) | (无) | ✅ | 一致 |

**合计 952 例通过**(升级前 951;差额来源见上表 `session-links` 行)。升级前
的 5 包构建失败(归档 change 阶段四实测)全部消除。

### 测试期望改动清单(spec「不得为迁就适配而修改测试期望」的合规说明)

以下测试文件被改动;每一处都是**装置/契约锚点随运行体更新**,没有任何一处
放宽了断言或删除了场景:

| 文件 | 改动 | 性质 |
|---|---|---|
| `worktree-session/test/agent-loop-context.test.ts` | harness 补 `ctx.plugin(SessionProjection)`;`session.events` → `snapshotEvents()`;`CallId` → `ToolCallId` | 装置补依赖 + API 更名 |
| `worktree-session/test/ws-confirmation-channel.test.ts` | 假 Session 由 `events: [...]` 改为 `snapshotEvents: () => [...]` | 装置贴合新 Session 面 |
| `dsh-pet/test/loader-composition.test.ts` | 同上的假 Session 改写;安装物探测同时看两个 node_modules 根 | 装置 + npm 布局 |
| `dsh-pet/test/client.test.ts` | 目录 API 契约锚点改指 `dsh-api-workspace-controller` 的 remote 声明;令牌/字体断言改指 0.1.2 实际词汇表 | **锚点跟随真实契约**,断言强度不变(仍要求「引用运行体真实定义的令牌」) |
| `session-links/test/produces.test.ts` | 夹具由已移除的 `callView` 改为真实调用头;场景一一对应保留并新增一个编辑器命令场景 | 夹具随契约,场景不减 |
| `session-links/test/collector.test.ts` | 同上夹具改写;快照类型改用 collector 自有的最小面 | 同上 |

### E1 `authority` 回环边界 —— **实测成立**(4.2)

隔离实例 `http://127.0.0.1:3081`(运行体 `0.1.2-rc.1`)上对三个 channel 实发 HTTP:

| 探针 | `/dsh-system-clock/now` | `/dsh-home-network-model-guard/check` | `/dsh-session-links/links` |
|---|---|---|---|
| 回环 + 已认证 | ✅ HTTP 200,返回业务采样 | ✅ HTTP 200,返回 verdict | ✅ HTTP 200(业务错误「sessionId is required」,证明已受理) |
| 回环 + 未认证 | **401 unauthorized** | — | — |
| `Host: 192.168.64.3:3081`(本机 LAN IP) | **403 forbidden** | **403 forbidden** | **403 forbidden** |
| `Host: evil.example.com` | **403 forbidden** | — | — |
| LAN Host + **已认证 cookie** | **403 forbidden**(fence 先于认证,认证不能绕过) | — | — |

结论:非回环来源在任何情况下都拿不到业务数据;边界不弱于 `0.1.1-rc.2` 的
per-channel `authority: 'loopback'`(旧版仅 403,新版 403 + 401 两道)。
附带证据:`worktree-session` 的 `/worktree-session/api/repo-status` 同样
在 LAN Host 下返回 `UNTRUSTED_REQUEST` 403,而回环已认证返回正常仓库状态。

**遗留约束(已写入 spec 与 dsh.yaml)**:该边界现在由 connection 层的
`trustedHosts` 配置面统一决定(本部署为空)。若将来给 profile 配置
`trustedHosts`,所有 channel 会一并放宽 —— 这是一次显式安全决策,不得顺手加。

### E2 `Session.events` 替代读取 —— 成立

两包的替代路径相同(`snapshotEvents()` / `seq`),各自测试套件全过
(`dsh-pet` 575、`worktree-session` 201),判定口径未变。

### E3 `registerContinuableSetup` 承接 —— 成立

改用 `agent/created` + `agent/disposed` 后,`worktree-session` 201 例全过,
其中「把父绑定继承进未发布的 child」「cleaned Session 在真实 ToolRuntime
派发路径上仍 deny-all」「release 后解除并只投影一次」等原有场景全部保留。

### B1 「确实加载并可用」(4.3)—— 程序化证据

隔离实例启动清单 **20 项全部加载**(8 个自研包在列),浏览器实际收到的
client 模块清单里 8 个自研包的 `client.js` 全部在列:
`dsh-worktree-session` / `dsh-sidebar-session-provider-icon` /
`dsh-session-title-copy` / `dsh-system-clock` /
`dsh-home-network-model-guard` / `dsh-pet` / `dsh-session-links` /
`dsh-subscriptions-sandbox-shim`(host-only,随 bundle 加载)。
最近一次 boot 之后的 `dsh.log` 无任何 error/duplicate 记录。

`dsh-client-ui-model-selection/client.js` **确认在浏览器模块清单中**
(design D6 要求的反「静默不激活」检查通过)。

> 口径说明:B1 原判据是人工目视(时钟走秒、徽标、logo、tab、浮层……)。
> 本轮以「模块确实被服务到浏览器 + 无加载错误 + host 半区 RPC 实测可用」
> 作为程序化等价证据;需要人眼确认的视觉项(时钟走秒、划选提问、tab 计数)
> 仍留待用户在隔离实例 `http://127.0.0.1:3081` 上过一遍。

### B2.1/B2.2 `worktree-session` 编排与安全门(4.4)

- **B2.1**:本 change 的全部实施过程都在这个 Worktree Session 内完成,
  数百次 Bash 调用无一被 guard 误拦;`ws status` 返回 `phase: prepared` 且
  repoRoot/taskBranch/worktreePath/dshHome 齐全;主 checkout 始终停在 `main`。
- **B2.2**:`ws promote` 在本 Session 内按规则正常放行(依赖模式 lean→mutable),
  越界/身份不可证明的破坏性操作路径未被触碰;LAN Host 访问 ws host 路由被
  `UNTRUSTED_REQUEST` 拒绝(见 E1 附带证据)。

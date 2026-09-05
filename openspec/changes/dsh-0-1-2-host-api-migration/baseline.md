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

### ⚠ 验收发现的**范围外破坏**:dsh-cockpit 无法连接 0.1.2 实例(2026-09-05,用户实测)

用户用 `dsh-cockpit`(`../dsh-cockpit`,本仓库外的自研项目)连隔离实例 3081,
报 `DSH_UNAVAILABLE: rc.2 host.describe HTTP 401`。已复现并定位:

**根因:`/api` 通道在 0.1.2 从「非结构化 RPC 代理」换成了「typert 网关」,
三处同时变**(实测对比 :3080 旧实例与 :3081 新实例):

| 维度 | `0.1.1-rc.2`(:3080) | `0.1.2-rc.1`(:3081) |
|---|---|---|
| 认证 | `/api/*` **无需认证**即可调用 | 需浏览器会话认证,未认证 **401** |
| 端点命名 | 点号 `host.describe` / `session.list` / `workspace.list` | 斜杠命名空间 `session/list`;`host.describe`、`workspace.list` **404** |
| 载荷形状 | `{type,rpcId,method,payload:{}}` | `payload` 必须是 `{args:{…}}`,且 args 需匹配 descriptor(如 `session/list` 要求 `_request`) |

cockpit 的 `rc2-client.ts` 依赖 `host.describe`(探活)、`session.list`、
`workspace.list` 与 WebSocket `/api/events.<stream>`,三个 REST 端点在 0.1.2
全部不可用;`host.describe` 甚至没有对应的新端点(host facts 改由网关 ready
帧的 `$host` 承载,不再是 RPC 方法)。

**判定**:这是**本 change 范围之外**的破坏 —— cockpit 是独立项目,不在本
仓库 8 个自研包内,也不在归档基线 A/B 清单里(基线 B1.x 只覆盖
`dsh-cockpit-bridge` 浏览器插件,而 bridge 走 postMessage + 驾驶舱自有
协议,**不受影响**)。按 spec「适配无法保持原语义时应停止并作为设计问题
上报」,此处不就地改 cockpit,而是作为显式决策交由用户处理。

**影响面**:仅「驾驶舱能否观测该设备」;DSH 本体、8 个自研包、浏览器端
全部正常(见上文 B1)。日常 GUI(:3080,仍 `0.1.1-rc.2`)不受影响,
故**回主 checkout 物化前必须先决定 cockpit 的处理方式**,否则驾驶舱会
在主机升级后失去对本机的观测。

**待用户决策的选项**(均需独立 change,不在本 change 内做):
1. cockpit 侧适配 0.1.2 网关(改端点命名 + 载荷形状 + 补认证;
   `host.describe` 需改用其它探活方式,如 `session/list` 或 ready 帧);
2. cockpit 侧做双协议兼容(按探测结果走 rc.2 或 0.1.2 两套);
3. 暂时接受驾驶舱对已升级设备不可用,推迟到 cockpit 跟进后再升主机。

### B1-补 「loader 可执行」审计(2026-09-05 补做,吸取 archive-manager 教训)

原 4.3 只验证了「模块被服务到浏览器」,而 `@tangzai/dsh-ui-archive-manager` 证明
这个口径不足:它被正常服务,但 `require("@deepseek-ai/dsh-client-runtime/client")`
指向 0.1.2 已移除的包,materialize 时抛错并**中止整个 client module loader**
(所有插件的浏览器半区一起死)。

补做的判据是「**每个已服务模块的 require 目标都必须可解析**」。解析域由实测确定:

- **seed 静态表 8 项**(shell bundle 的 `staticModules`,实测读出):
  `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` /
  `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-store` /
  `@deepseek-ai/dsh-client-ui-slots` / `@deepseek-ai/dsh-client-ui-primitives`
- **已注册模块 id**:实际抓取 boot manifest 的 combo 批次脚本,提取
  `__ModuleLoader__.load({id})` 注册的全部 id(实测 376 个)

**审计结果(0.1.2-rc.1 隔离实例,61 个已服务模块)**:全部 require 目标可解析,
loader 可完整 materialize ✅

**规则有效性双向验证**:同一规则对已禁用的 archive-manager 判定为命中死包 ❌ ——
说明规则确实能抓到这类破坏,不是空过。

> 重要区分(实测得出):`package.json` 的 `dsh.client.inject` 只是**模块图依赖边**,
> 图里没有的 id 会被 `arriveGraphRow` 静默跳过,**不阻塞激活**。因此
> `dsh-sidebar-qa` / `dsh-open-in-vscode` / `dsh-setting-restart` 仍在 inject 里
> 声明已移除的 `@deepseek-ai/dsh-client-runtime` 属于**声明滞后而非故障**
> (三者的 client bundle 均不 require 该包,runtime inject 用的是服务名)。
> 真正致命的是 bundle 内的 `require()`。

### B1/B3 人工可见证据(5.3,2026-09-05 用户在隔离实例逐项确认)

用户在 `http://127.0.0.1:3081`(运行体 `0.1.2-rc.1`,bridge 0.3.0,
archive-manager 已禁用)上确认下列可见证据**全部正常**:

| # | 项 | 判据 | 结果 |
|---|---|---|---|
| B3.1 | `sidebar-qa@0.5.0` 划选提问 | 划选文本 → 出现「提问」→ 能开侧边问答会话 | ✅ |
| B3.2 | 模型选择可用 | 侧边问答的模型选择未静默消失(`dsh-client-ui-model-selection` 实际生效) | ✅ |
| B1.4 | `session-links`「文档/资料」tab | tab 注册成功,badge 计数正常 | ✅ |
| B1.1 | `system-clock` | 设置页最底部时钟走秒 | ✅ |
| B1.2 | `session-title-copy` | 标题旁 6 位 id 徽标 | ✅ |
| B1.3 | `sidebar-session-provider-icon` | 侧边栏会话行模型 logo | ✅ |
| B1.5 | `dsh-pet` | 桌宠浮层常驻可见 | ✅ |
| B3.3 | `better-sidebar@0.18.0` | 各面板可开,无 duplicate prefix route | ✅ |

至此隔离环境验收(任务 4.x / 5.x)全部完成:程序化证据(模块服务清单、
loader 可执行审计、RPC 回环边界、952 例测试)与人工可见证据互相印证,
无一项以「无报错」代替「可见证据」。

### 6.1 回主 checkout 物化与复跑(2026-09-05)

任务分支经 `scripts/ws-merge.mjs --yes` 合入 `main`(merge commit `6c5c24a`),
主 checkout `npm install` 后物化到日常 `~/.dsh` 并重启。

**执行顺序更正(实施中发现)**:tasks 把 6.1 列在 6.2「提交 commit」之前,
但真实依赖是**先合并、再物化** —— `~/.dsh` 的 local package 装的是
`file:/…/ohmydsh/packages/*`(主 checkout 源码)。若在合并前物化,manifest 会
声明 `0.1.2-rc.1` 而装入的却是未适配的旧代码,日常 GUI 必然起不来。

**一次性环境准备**(与隔离 home 同因):`~/.npmrc` 指向内网 bnpm,公共包 404,
首次物化 12 项失败。修法与隔离环境一致 —— 在 `~/.dsh/profiles/web/.npmrc`
固定 `registry=https://registry.npmjs.org/`。**该失败是干净的**:pnpm 在变更前
拒绝,`~/.dsh` 未进入中间态(复核 profile 各 pin 仍为升级前值),日常实例
全程未中断。

**升级后复跑结果**:

| 检查 | 结果 | 与升级前比对 |
|---|---|---|
| 主 checkout `npm test` | ✅ 96:95 通过 / 1 跳过 | 一致 |
| `npm run check:artifacts` | ✅ | 一致 |
| 8 包 build / typecheck | ✅ 全过 | **A3 的 `dsh-pet` typecheck 环境漂移已消失**(install 刷新后 `@types/react-dom@18.3.7` 到位) |
| 8 包 test | ✅ 952 例 | 与隔离环境一致 |
| `node scripts/sync.mjs` ×2 | ✅ 第二次 `no changes` | 幂等 |
| 日常实例 | ✅ `dshVersion=0.1.2-rc.1`,启动清单 **19 项**,boot 后日志无 error | 21→19 = archive-manager 禁用、traex 本就未启用 |
| E1 回环边界(日常 :3080) | ✅ 未认证 401 / 非回环 Host 403 | 与隔离实例一致 |

### ⚠ 用户实测发现的迁移回归:输入框 Worktree 标记消失(2026-09-05)

主 checkout 升级后,用户发现**输入框上的 Worktree Session 标记不见了**。
这是一处**本次迁移引入的真实回归**,且我此前的全部验收都没抓到。

**根因(两层)**:

1. **表层 —— slot props 契约变更**:0.1.2 的 `scope: 'session'` 槽位提供
   `useSession` / `sessionId` / `useProjection`;`0.1.1-rc.2` 的 `session` 值与
   `useSessions` 列表 feed 均已移除。`WorktreeControls` 仍解构后者,
   `useSessions(...)` 调用 undefined → 组件渲染即抛 → 标记消失。
   插件本身加载正常(bundle 已服务、slot 注册成功),**死在渲染阶段**。
   适配:改用 `useSession` 取生命周期状态;`cwd` 是列表行事实
   (新 `SessionSnapshot` 不含),改经注入的 `sessions` 服务的 list store 读取。

2. **深层 —— 该文件从未被 typecheck 过**:`tsconfig.json` 声明
   `exclude: ["src/client"]`(host 构建不应编译浏览器代码),而
   `tsconfig.client.json` 只 `extends` + 设 `include`、**未覆盖 `exclude`**,
   两者相抵 —— `tsc` 编译 0 个 client 源文件并退出 0。
   全仓扫描:`worktree-session` 与 `sidebar-session-provider-icon` 两个包
   如此(其余 5 个写了 `exclude: []` 故正常)。**这意味着我此前报告的
   「8 包 typecheck 全绿」对这两个包是假的** —— 检查器根本没看 client 代码。
   `git show f55dbe3` 确认迁移前同样如此,故非本次引入,但正是它让
   `useSessions` 这类错误得以一路通过。

**修复后首次真实检查暴露 10 个类型错误**,已全部处理:
`ctx.slots`/`ctx.sessions` 的 Context 合并缺 type-only import(0.1.2 拆包所致)、
`ClientStage.error` 与 `Decoration.flight` 在 `exactOptionalPropertyTypes` 下
需显式 `| undefined`(清除语义依赖 spread 覆盖)、`satisfies` 字面量收窄
掩盖了后赋值属性、`directoryFor` 的 SessionId brand。

**测试装置同步纠正**:`controls.test.ts` 原先自造 0.1.1 契约的 props
(`session` + `useSessions`),因此在真实槽位已经抛错时仍全绿 —— 夹具改为
镜像 0.1.2 真实契约后,反而先暴露了我修复中的 `useSyncExternalStore` 缺少
server-snapshot 参数(静态渲染必需),一并修正。

**新增回归守卫**:`tests/client-typecheck-coverage.test.mjs` —— 任何
`tsconfig.client.json` 若解析出的 `exclude` 抵消了自己的 `include`,即失败。
已双向验证(移除 `exclude: []` 时该守卫报错,恢复后通过)。

**验收口径教训**:我此前以「bundle 被服务 + loader 可 materialize」作为
「确实加载并可用」的程序化证据,但组件是在 **React 渲染时**才抛错的,
比 materialize 晚一步 —— 程序化证据够不到的部分,必须由人工可见证据兜底
(基线 B1 的原始判据本就如此,是我在 4.3 放松了口径)。

### 回归修复后的重新物化与验证(2026-09-05)

修复经 `ws-merge` 合入 `main`(fast-forward 到 `a3d46f0`),主 checkout
`npm install` 后重新物化并重启日常实例。

| 检查 | 结果 |
|---|---|
| 主 checkout 8 包 build / typecheck / test | ✅ 952 例;两个包的 client 源码**首次真正参与编译** |
| 仓库 `npm test` | ✅ 97 例:96 通过 / 1 跳过(新增 client-typecheck 守卫) |
| `node scripts/sync.mjs` ×2 | ✅ 第二次 `no changes` |
| 部署物携带修复 | ✅ `~/.dsh` 的 client.js 中旧 `useSessions` 计数为 0 |
| 日常实例 | ✅ `dshVersion=0.1.2-rc.1`,19 项启动清单,进程启动时间晚于新 bundle 物化时间 |
| 浏览器实际收到的 bundle | ✅ 抓取 boot manifest 的 combo 批次实测:`useSessions` 0 次、`useSession` 2 次、`useSyncExternalStore` 1 次 |

> 注:重启后必须核对**进程启动时间晚于 bundle mtime** —— 第一次重启命令
> 未真正生效(进程仍是旧的),仅凭「端口通」会误判为已生效。

### B2.1/B2.2 `worktree-session` 编排与安全门(4.4)

- **B2.1**:本 change 的全部实施过程都在这个 Worktree Session 内完成,
  数百次 Bash 调用无一被 guard 误拦;`ws status` 返回 `phase: prepared` 且
  repoRoot/taskBranch/worktreePath/dshHome 齐全;主 checkout 始终停在 `main`。
- **B2.2**:`ws promote` 在本 Session 内按规则正常放行(依赖模式 lean→mutable),
  越界/身份不可证明的破坏性操作路径未被触碰;LAN Host 访问 ws host 路由被
  `UNTRUSTED_REQUEST` 拒绝(见 E1 附带证据)。

# 任务：DSH 记忆设置页

## 0. 实施前诊断（阻塞项：未完成不进入第 2 章）

- [x] 0.1 对照当前 pin 确认 `settings.section` 仍只接受 `id / order / label`（无 icon 字段），并确认官方图标集中确实没有 book 类图标——图标方案取决于此
- [x] 0.2 确认 `ctx.settingsScope.bind({ namespace })` 在当前 pin 的可用形态，以及 `mutate` 的 path-op 形状能否把整份 `scopes` 数组作为**一次带 revision 围栏的原子操作**提交
- [x] 0.3 确认 connection RPC 通道在 0.1.2-rc.1 的注册写法（无 `authority` 注册参数，回环/认证边界由 connection 层统一施加）——对照 `system-clock` 与 `home-network-model-guard` 的现行实现
- [x] 0.4 确认 `packages/dsh-memex` 增加 Web 半区的构建路径：`dsh.client` 声明、tsdown client 配置、`exports["./client"]`，并确认 `scripts/sync.mjs` 会构建与部署该产物
- [x] 0.5 实测 `memex sync --status` 在**三种库状态**下的输出（已配置远端 / 未配置 / 目录不存在），据此确定解析契约并确认失败时不会创建任何目录
- [x] 0.6 实测确认 `memex sync --init <url>` 对一个**已存在且已有卡片**的库不会 `git init`、不删卡片；记录合并冲突时的实际行为（供 D7 的失败语义核对）

## 1. 解析层：本地派生与完整性约束

- [x] 1.1 实现无仓库目录的本地路径派生：取路径末两段、`-` 连接并归一化；归属标识用 `local/<绝对路径>`（与 remote 的 `host/path` 同构）
- [x] 1.2 归一化后不满足 scope 名规则时落到固定的本地兜底库名，保证解析是全函数
- [x] 1.3 把本地派生接入既有的「不同来源派生出同名 → 报错」保护，确认远端与本地两条路径撞名时给出明确错误
- [x] 1.4 解析层新增动态重叠检测：一个 remote 同时匹配多个 scope 的 remote 模式时报错并指明两方，替换今天「按配置顺序第一个命中即生效」
- [x] 1.5 扩展 `validateMemexSettings`：同一 `home` 被两个 scope 共用、同一 remote 模式字面重复 → 拒绝并指明两方
- [x] 1.6 fallback 不再返回 `personal`；确认 `list()` 对 `personal` 的强制包含与 `accessFor` 的隐式可写目标**保持不变**（design D10）
- [x] 1.7 确认本地派生的库在用户显式配置远端之前不产生任何推送或拉取（`syncHook` 路径不需要改动，属确认项）
- [x] 1.8 确认解析结果中的来源标注能区分「配置 / remote 派生 / 本地派生 / 命名空间下发现」四种

## 2. 只读事实通道

- [x] 2.1 `contract.ts`：通道名、端点名与返回类型（`stores` / `resolve` / `kernel`）
- [x] 2.2 Host 端 `stores` 实现：并发上限 4 采样各库，`sync --status` 的解析集中在单一模块并绑定内核版本；未配置远端时如实返回「未配置」
- [x] 2.3 `resolve` 端点实现为**纯查询**，绝不走会创建目录的 `ensure` 路径
- [x] 2.4 枚举命名空间下已存在但未被配置声明的库，并标注其来源（含「派生得到」与「目录已存在」）
- [x] 2.5 失败语义：单个库采样失败不影响其余库的返回；内核不可用时如实上报不可用，不返回推测值
- [x] 2.6 远端写入端点（未配置→配置 / 同步 / 拉取 / 自动同步开关 / 更换远端），全部委托内核 CLI，系统自身不写库内文件；错误只上报 stderr 摘要

## 3. Web 半区与页面

- [x] 3.1 client 半区骨架：`dsh.client` 声明、tsdown 配置与 externals、样式注入、locale 字典（zh/en）
- [x] 3.2 注册 `settings.section`（id `dsh-memex`、order 就位、label「记忆」）
- [x] 3.3 三列渲染：工作区 / 库的本地路径（默认地址占位，可复制）/ 远端存储（只读，可复制）
  - **2026-09-20 实机反馈后重做视觉**（用户：面板已出现但"太难看"）。按新装的 `frontend-design` skill 走「先出 token 方案 → 对照 brief 自查 → 再写代码」：三列等权卡片改为**书架**（每个库一条细线分隔的块）；**2026-09-20 第二次实机反馈后改为上下结构**（用户：左右分栏把路径挤到裁切、远端折行、动作区参差；且提示「一个 workspace 应对应多个记忆入口吗」——核实后路由是 N 工作区 → 1 入口，故正确的呈现主语是记忆入口）：块内上半是「关联仓库」、下半是「记忆入口」，整块左侧一条**竖脊线**作为贯穿物，把「这些工作区共用这个库」直接画出来；字段改为**静默字段**（平时看起来就是文本，hover/focus 才成为输入框）；事实改成「标签—值」列表，去掉 `·` 拼接；按钮改为文字按钮；删掉与占位重复的「默认路径」行与冗余的"已声明"徽标。
  - **顺带修掉一个暗色模式真缺陷**：原 CSS 用的 `--dsw-alias-border` / `--dsw-alias-bg` / `--dsw-alias-bg-danger` / `--dsw-alias-border-focus` **在真实主题里不存在**，会一直走硬编码 fallback → 暗色下颜色全错。已对照官方 token 定义表（`ui-theme/src/styles/design-platform.css`）改用真实变量：分隔线 `border-l2`、层背景 `bg-layer-2`、状态色 `state-{error,success,warn}-primary`、主按钮 `button-primary-fill` + `label-primary-foreground`、焦点环 `brand-primary`。
- [x] 3.4 编辑路径前缀与库路径、增删条目，经 `settingsScope.mutate` 提交；保存以 Host 回读为准，被拒时保留原值并说明原因
- [x] 3.5 编辑期完整性拦截：重复库路径、字面重复的 remote 模式——阻止保存并指出冲突的另一方
- [x] 3.6 远端列两态：未配置 → 配置动作；已配置 → 立即同步 / 拉取 / 自动同步开关 / 更换远端（独立动作 + 确认），**不出现初始化或重建类动作**
- [x] 3.7 未声明库清单与「声明」动作（含发布方向，默认取保守值）
- [x] 3.8 通道不可达时的降级：库事实列显示不可用，编辑仍可用，不显示推测值；另提供路径试解析输入
- [x] 3.9 导航 book 图标适配：按可见文案标记自己那一行 + 配对 CSS（自绘 16px 线性 SVG 作 mask，跟随 currentColor）；匹配不到时不动作，释放时清除全部标记

## 4. 多入口工作区（模型 B：一个工作区关联多个入口）

- [x] 4.1 `ScopeEntry` 增加 `primary` 字段（schema + 类型），并在 settings 校验里落实唯一性：同一路径前缀 / 同一字面 remote 模式被多个 scope 声明时，恰好一个必须标主入口，否则拒绝并指出全部冲突方
- [x] 4.2 解析层：路径前缀改为收集**同级全部**命中者（按路径段数最长的那一层），主入口即当前 scope，其余进入关联入口集合；缺/重复主入口时报错并列出命中者（替换原来的"取第一个"）
- [x] 4.3 解析层：remote 模式命中多个 scope 时改为同一套主入口判定（不再是"多命中即报错"）
- [x] 4.4 `ScopeResolution` 携带 `entries`（主入口在前）与 `access`（可达 = 主入口 ∪ 关联入口 ∪ 绑定集合 ∪ personal 规则）；`accessFor(scope)` 退化为枚举视图上的同名语义
- [x] 4.5 工具层改用 `current.access` 作为可读/可写候选集，并在拒绝信息里区分"绑定外"与"工作区未关联"两种原因
- [x] 4.6 确认**默认动作只作用于主入口**（不指名时读取与写入都不碰附加入口），并补上对应用例
- [x] 4.7 通道：`stores` 视图补 `primary`（该 scope 是否为主入口）与同组入口信息，供页面成组
- [x] 4.8 页面：主语改为「一组工作区」，组内列出多个入口并标出主入口/附加入口；路径编辑应用于整组；新增第二个入口时自动为原入口补主入口标记并在提示里说明
- [x] 4.9 页面：组内主入口切换动作，以及"缺主入口 / 多个主入口"两类冲突的保存前拦截
- [x] 4.10 端到端：构造 `proj-internal`(主) + `proj-public`(附) 的配置，确认真实内核下默认只写主入口、显式指名才写附加入口、且附加入口按其发布方向各自过守门

## 5. 测试

- [x] 5.1 解析层单测：本地派生命名、同名末段的不同目录不共库、兜底名、不同来源撞名报错
- [x] 5.2 校验单测：重复 `home` 与字面重复 remote 模式被拒并指出两方
- [x] 5.3 解析单测：remote 模式重叠时报错而非静默取第一个
- [x] 5.4 通道单测：`stores` 的合并与失败隔离；`resolve` 无副作用（对不存在的路径调用后文件系统不出现新目录）
- [x] 5.5 页面测试：默认占位、复制、通道不可达降级、保存回读、冲突拦截、已配置库不出现初始化动作
- [x] 5.6 图标适配测试：标记只落在自己那一行；定位失败时不抛错且页面照常渲染
- [x] 5.7 方向未知不推测的单测：未声明库（`publishKnown: false`）的事实区显示「未知」，内部/外部文案都不出现

## 6. 文档与部署

- [x] 6.1 `packages/dsh-memex/README.md`：设置页能做什么与不能做什么；fallback 由 `personal` 改为本地派生；远端动作的边界（委托内核、不重建）
- [x] 6.2 `docs/notes/dsh-memex-integration.md`：fallback 语义变化与迁移说明；远端写入的状态分流；「不重建」由内核语义保证的实测结论
- [x] 6.3 `dsh.yaml`：该条目版本与 note 更新（新增 Web 半区、图标适配、fallback 行为变化）
- [x] 6.4 `dsh build` 物化并重启（重启必须脱离调用方进程，用 `setsid`）
  - **2026-09-20 实机经过**：先被 D004（profile 里 4 个 `file:` 依赖指向已删 worktree）挡住，pnpm 失败 → 按 D004 的绕过方式从主 checkout 修复这 4 个路径（`~/.dsh/profiles/web/package.json`，改动前备份到 `/tmp`），随后 `dsh build` 成功补齐 `lib/client.js`（md5 与仓库产物一致：`ce3b94c4…`）并重启；01:12 之后的两次启动（11:42:26 / 11:42:58）中，后者启动干净、清单含 `dsh-memex`、无 `client bundles not found`。
  - ⚠ **本次踩到的新坑（已记 BACKLOG D005 与 `docs/notes/dsh-plugin-integration-pitfalls.md`）**：local package 的部署副本与仓库源是**硬链接**，所以在仓库里加 `dsh.client` 等于立刻改线上 manifest；而 `lib/client.js` 还没部署时，运行体在**启动期**直接 `plugin tree failed to load`（整个 profile 起不来）。规则：**新增启动期要求时，声明与满足它的文件必须在同一次 `dsh build` 里落地**。
  - **2026-09-20 实测阻塞（与本次改动无关）**：`node scripts/sync.mjs` 在修复 `incomplete deployment dsh-memex: missing lib/client.js` 时失败，pnpm 报 `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`——profile `package.json` 里 4 个 `@deepseek-ai/dsh-storage*` 的 `file:` 依赖仍指向已清理的 worktree `.worktrees/change-openspec-changes-dsh-memex-scoped-memory/…`，而 sync 判定 `dsh-pet up-to-date` 后不再重写这些路径。根因/影响面/修复方向见 `BACKLOG.md` D004。
  - **恢复步骤**：先从主 checkout 重新执行一次 dsh-pet 的 add（sync 本来会跑的那条命令，把 4 个 `file:` 路径改写成当前 checkout 的绝对路径），再重跑 `node scripts/sync.mjs`；随后按 6.x 在备用端口验收。若选择先停 3080 再操作，重启必须 `setsid` 脱离调用方进程。
- [x] 6.5 幂等校验：`node scripts/sync.mjs` 连跑两次报 `no changes`
  - 已先在**隔离 DSH_HOME**（`/tmp/dsh-accept-home`，web profile 的 APFS clone）验证：第 1 次 `18 change(s) applied`、第 2 次 `no changes — deployment already matches manifest`。
  - 线上同样通过：修复 D004 后连跑两次均为 `no changes — deployment already matches manifest`（中间那次 `1 change(s) applied` 是补装此前被 pnpm 挡住的 `@byted/dsh-traex-bridge`）。

## 7. 验收

> 2026-09-20：6.3/6.4/6.5/6.6/6.7/6.8 已用**真实 settings + 真实内核**验证通过（路由不变、无仓库目录独立建库且无远端、守门行为不变、不重建、换远端需确认、页面无守门控件）。6.9/6.10/6.11 已有 jsdom 级用例覆盖（`test/page.test.tsx` 12 例、`test/nav-icon.test.ts` 3 例），**实机浏览器确认待人工看一眼**（部署已到位）。6.12 已完成。6.1/6.2 需在 GUI 里核对三部分数据与复制。
>
> 7.1 预检（真实内核逐库 `sync --status`）：`personal` → `git@github.com:prgrmrwy/dsh-memex.git`（external，auto，last sync 2026-09-20T04:20Z）、`nexus` → `code.byted.org:zhangyong.617/memex-nexus.git`（internal，auto，09-19T17:52Z）、`flow-web-monorepo` → `code.byted.org:zhangyong.617/memex-flow-web-monorepo.git`（internal，auto，09-19T17:52Z），三库 exit 0；探针库 `acceptance-probe` 无远端、方向未知。GUI 里照此核对即可（7.13/7.14）。

- [ ] 7.1 **页面数据正确**：三个部分的内容与本机真实库、真实远端一一对应；已配置的库显示 remote / auto / last sync / 发布方向
- [ ] 7.2 **复制可用**：复制出的库路径可直接在终端使用；远端地址可原样粘贴为 git remote
- [x] 7.3 **fallback 行为**：在一个无仓库目录（如 `~/Documents/learning`）开会话写卡，确认落到该目录专属的库、位于 `~/.dsh-memex/` 下、且**不产生任何推送**
- [x] 7.4 **已声明路由不变**：`~/mydir/dev/nexus`、`flow-web-monorepo` 仍解析到原 scope；`personal` 覆盖的工作区仍解析到 `personal`
- [x] 7.5 **不重建**：对一个已配置远端的库执行「立即同步」，确认库目录与卡片数量不变、内核未重新初始化
- [x] 7.6 **换远端需确认**：未确认时不下发任何命令
- [x] 7.7 **无守门开关**：检查页面可编辑字段，确认不存在改变发布方向的控件
- [x] 7.8 **守门行为未变**：对 `publish: external` 的目标写入含内部 scope 名的卡片，确认仍被拒且不落盘
- [ ] 7.9 **通道降级**：断开通道后确认页面仍可编辑、库事实显示不可用、不出现推测值
- [ ] 7.10 **图标**：导航行显示 book 图标；人为破坏定位条件后确认页面与官方齿轮均正常
- [ ] 7.11 **未声明库可见**：制造一个未声明的库（例如在命名空间下放一个有 cards 的目录），确认它出现在清单中并可声明
- [x] 7.12 **多实例安全**：切到备用端口验收，全程不碰 3080
  - 隔离 home + 备用端口 3091 实测：启动清单含 `dsh-memex`、运行日志 0 报错、`HTTP 401` 边界正常，验收后已 stop 并释放端口（3080 全程未碰）。
  - 线上组合的干净启动由 11:42:58 那次重启验证（清单含 `dsh-memex`，无 client-modules 报错）。
- [x] 7.13 **方向未知不推测（7.1 预检发现并修掉的真缺陷）**
  - 预检 7.1 时用真实内核逐库跑 `memex sync --status`（与通道 `sampleSync` 同路径、同解析器），四个库 exit 0、远端/auto/lastSync 全部解析成功；但发现「发布方向」在页面上是**二值**渲染（`publish === 'external' ? 外部 : 内部`），完全忽略 `publishKnown`。于是未声明的库（无声明、无远端证据）会被显示成「内部（卡片不出网）」——而守门对这类目标恰恰是**拒绝**（`configuration:publish-unknown`），这是页面能给出的最误导的一种推测值。
  - 触发场景真实存在：在「未在配置中的库」里点「声明」后，该条目立刻带上 Host 报来的 `publishKnown: false` 事实，正好停在最需要知道方向的时刻。
  - 修复：`locales.ts` 新增 `publishUnknown`（中英），`page.tsx` 按 `publishKnown` 渲染「未知（既没有声明也没有远端证据，写入会被拒绝）」；「未声明库」段落提示补齐「声明只把库纳入配置，方向未写时按 external 处理」。spec 增加 scenario「发布方向无法证实时不推测」，并明确声明动作本身不构成方向证据。
  - 验证：`test/page.test.tsx` 新增用例（断言出现 `publishUnknown`、且 `publishInternal`/`publishExternal` 都不出现），全量 130 例通过；typecheck、build、`check:artifacts` 通过；`node scripts/sync.mjs` 部署后连跑两次均 `no changes`，部署副本与仓库产物 md5 一致（`2e0719a6…`）。
- [x] 7.14 **未声明库探针就绪（7.11 的前置数据）**：在真实命名空间放一个隔离探针库 `~/.dsh-memex/acceptance-probe/cards/…`（无声明、无 git 仓库、无远端 → 不参与路由、不推送），并用真实 settings + 真实命名空间跑通解析器与页面过滤函数：`source=discovered`、`declared=false`，且出现在页面「未在配置中的库」清单里（`UNDECLARED-PROBE-OK`）。验收后可 `rm -rf ~/.dsh-memex/acceptance-probe` 删除。
  - 顺带实测了守门对「未声明库」的两条设计规则（`guard/index.ts` 注释里写的行为）：探针存在期间，向 `personal`（external）的写入**没有被拒绝**，只多了一条 warning `configuration:known-scope-publish-unknown`（本条记录本身就是那次写入）；同时探针名成为 external 写入的 deny 词。即**命名空间里的游离目录不封锁外部写入，只提高警惕**——这正是 fail-closed 与 fail-noisy 的分界。探针撤掉后 warning 即消失，因此验收后应尽快删除。

## 8. 归档准备

- [x] 8.1 运行 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`，记录实际输出
- [x] 8.2 package 内 typecheck / test / build 与实际启动清单核对
- [x] 8.3 确认三份 delta spec（新增 `dsh-memex-settings-ui`、修改 `dsh-memex-scope` 与 `dsh-memex-integration`）已反映最终实现行为
- [x] 8.4 回填 `BACKLOG.md` 与 `CHANGELOG.md`（如适用）
- [x] 8.5 复核 `design.md` 的 Open Questions，把已有结论的回填进 design 或转成后续条目

## 9. 第二轮：页面主语改为工作区（2026-09-20 追加）

> 触发：实机验收时用户提出五条反馈——(1) 没有用 `memex serve` 看卡片的入口；(2) 入口在列表里摊开 8 行事实、看不清有几个入口；(3) 文案换行（`已复\n制`）；(4) 点「+ 入口」随手填重名就撞出红字重名错误；(5) 「关联仓库」其实指路径。并重述了预期模型：**一个 workspace 下面挂入口，主入口默认派生，兜底附入口默认开启用 personal，可继续加附加入口**。

- [x] 9.1 核实 DSH 的 workspace 是真概念：`ctx.workspaceRegistry`（`dsh-workspace`，Service 名 `workspaceRegistry`，实体 `{id,title,path,createdAt,updatedAt,sessionIds}`）；本机注册表实际 8 条（nexus / ohmydsh / dsh-cockpit / flow-web-monorepo / dev-infra-server / DSH Pet / multica-runtime / learning），其中 4 条无任何配置
- [x] 9.2 页面单位改为工作区：新增 `workspaces` 通道端点（可选注入 `ctx.get('workspaceRegistry')`，缺席回答 `known: false` 而非空清单；随答案返回 `homeDir` 供浏览器展开 `~/`），客户端 `workspaceViews()` 以注册表为骨架，规则与解析器一致（只取**最深**匹配前缀的认领者），声明了路径但不属于任何工作区的条目单独成块保留
- [x] 9.3 默认主入口 = 派生（`route.scope`），**只作提议不写配置**；给未声明工作区挂入口或关兜底时 `stageAssumedPrimary()` 同时把派生主入口落成声明并在保存前提示（否则 `configuredPathMatch` 命中即返回，路由被静默抢走）
- [x] 9.4 兜底入口 `personal` 语义改为默认授予：`accessOf` 中兜底与绑定**各自独立相加**，`fallback: false` 关闭后读写都不可达；schema 新增 `fallback: boolean`（缺省即开启，只有显式关才落盘）；页面把开关放在行上（状态不该藏在折叠里），未声明工作区上关闭会连带 staging 派生主入口
- [x] 9.5 列表态只显示角色/名称/卡片数，展开显示路径与远端事实与动作；展开是纯视图状态（不进配置、不标脏）
  - 实机修正（用户截图）：角色徽标原判据是「真实入口多于一个」，而兜底行无条件画「附」→ 未声明工作区显示成「无标主入口 + 附兜底」。改为**行数（含兜底行）多于一行就每行都带角色**，并把竖脊线补回折叠态（入口容器左规则 + 展开体缩进 + 选择器同脊柱）。补两条用例：派生主入口 + 兜底 → `['primaryBadge','additionalBadge']`；只有一行 → 零徽标。
- [x] 9.6 入口由候选选择器添加：候选 = 已声明但不在本组的库 + 命名空间下未声明的库 + 「新建库…」；`attachEntry` 对已声明库**改它自己的条目**（一个库一条配置），不再追加同名行；重名因此从构造上不可达
- [x] 9.7c **主次区分度**（实机第二轮）：原来工作区标题与入口名同为 15px/500，每块还重复一个 11px「工作区」眉标，横线也只有一个粗细——整页读起来是一层。改为**三级**：工作区标题 17px/600（`label-primary`）、主入口名 15px/500、附加入口名 14px/400 且降为次要色，其余（计数/标签/散文）11–12px；**眉标只在不构成工作区时出现**（"未对应工作区的路径"是信息，重复"工作区"不是）；横线分三档——块间 `border-l3`、块内入口间 `border-l1` 虚线、脊柱 `border-l2`——让"工作区边界"和"入口边界"不再同权；facts 的 `dt` 降到 11px（值 12px）使标签不与内容争；段落提示（派生说明/兜底说明）用 12px/1.6 与数据区分；顺手删掉旧布局遗留的死规则（`.dshmx-body/.dshmx-part/.dshmx-fieldrow::after` 引导线）。强调仍只花在一处：填充的「保存修改」。
- [x] 9.7b **动作可点击性**（实机第二轮）：原来动作是纯文字按钮（`border:0` + 负 margin），实测「设置远端 / 声明为配置条目 / 展开箭头」看不出能点。改为**统一的弱按钮**：1px `border-l2` 描边 + 透明底 + 6px 圆角 + `label-secondary` 文字，hover 换 `border-l3` + `interactive-bg-hover` + `label-primary`，disabled 用 `label-dimmed` + `border-l1`；展开箭头是同一系统的方形图标按钮（22×22，与动作行同高）；选择器的 `<select>` 也套同一描边。**规则是不留例外**——描边与不描边混在一起正是"不知道什么能点"的来源；填充按钮（保存修改）仍是全页唯一的最高强调。
- [x] 9.7 呈现修复：**对齐改为光学居中**（实机第二轮：11px 说明、15px 名称、12px 控件混排时用共同基线会让控件漂移——`bar`/`lib-head`/`entry-line`/`fieldrow`/`value`/`actions`/`line`/`probe`/`attach` 全部改 `align-items:center`，展开箭头改 flex 居中、折叠行给 `min-height:22px`、开关的 checkbox 固定 14px）；「关联仓库」→「工作区」（`partWorkspaces`）；`.dshmx-act-inline` 加 `white-space:nowrap`（修掉 `已复\n制`）；远端 URL 加 `overflow-wrap:anywhere` 与 `min-width:0`；新增工作区标题/路径省略号、折叠行、展开体、开关、选择器等结构样式（全部沿用官方主题变量）
- [x] 9.8 单测：`test/scope.test.ts`（兜底默认授予 / 绑定不取消兜底 / 关闭后双向不可达 / 显式绑定覆盖关闭）、`test/channel.test.ts`（workspaces 端点返回路由与 homeDir；缺席与抛错都回答 known:false）、`test/settings-model.test.ts`（`~/` 展开与段级前缀匹配、最深认领者、派生提议不写配置、staging、挂载改自带条目、脱离只删该路径、兜底写在承载路由的条目上、候选不含已挂库）、`test/page.test.tsx`（工作区骨架与派生标记、折叠/展开、候选不出现本组已挂库、staging 提示与落盘内容、两处兜底开关）。全量 **155 例通过**
- [x] 9.9 文档：`design.md` D15–D19；`specs/dsh-memex-settings-ui`（工作区单位 / 候选选择器 / 兜底入口三处新要求 + 事实端点补 workspaces）、`specs/dsh-memex-scope`（可达范围与兜底语义改写）；`README.md` 页面章节重写、`CHANGELOG.md` 0.2.0 补记、`docs/notes/dsh-memex-integration.md` 新增「页面建立在宿主工作区注册表上」与两个坑；`dsh.yaml` note 追加二轮说明
- [x] 9.10 `memex serve` 卡片浏览入口**不在本 change**：它是新的进程能力（按需 spawn 长驻子进程、占端口、上游默认重定向到托管站点故必须 `--local`），风险面不同，按项目约定另立 change（`BACKLOG.md` B045），见 9.11
- [ ] 9.11 为 `memex serve` 入口另开 OpenSpec change（proposal/design/specs/tasks），实现「打开卡片」按钮：按需在对应库目录起 `memex serve --local --port <p>`、可停止、只用回环地址、生命周期随插件释放
- [ ] 9.12 二轮实机验收：刷新 GUI 确认工作区骨架（8 个工作区）、折叠/展开、候选选择器、兜底开关、派生主入口标记；并**必须重启**才能让 Host 半区的新端点与新 `accessOf` 生效（客户端 bundle 由 HMR 轮询重注册，Host 代码只在启动时加载）

## 10. 第三轮：按工作区关闭记忆（2026-09-20 追加）

> 用户要求：「支持关闭记忆」= 按照 workspace 禁用记忆；并选择**完全关闭**（不注入召回、不注入提醒、工具拒绝）+ 开关挂在入口上。

- [x] 10.1 语义与落点：入口声明 `memory: false`（schema 新增 `memory: boolean`，缺省即开启，只有显式关才落盘）；`ScopeResolution.memory` 随之携带，派生/本地/未声明路径默认开启
- [x] 10.2 强制点一（工具）：`currentFor()` 在**解析之后、`ensure()` 之前**判定，关闭则拒绝全部 8 个工具并说明"Settings → 记忆 里可以打开"——这样关闭的工作区连库目录都不会被创建；不做目标库的全局封锁（否则在 ohmydsh 关记忆会连带掐掉其它工作区写 personal 的兜底路径）
- [x] 10.3 强制点二（生命周期）：会话启动读一次路由，关闭则**不注入召回指令**、`off` 标记同时抑制写卡提醒；开关注释写明"按会话启动读取"，重新打开无需重启
- [x] 10.4 通道与契约：`MemexStoreView.memory`、`MemexResolveResult.memory`（页面据此显示状态）
- [x] 10.5 页面：开关放在**工作区标题行**（它是工作区的属性，不是某个入口的），关闭时显示含义说明，且不隐藏/禁用条目编辑；`setMemory()` 与兜底共用 staging 规则；顺手修掉一个真缺陷——**声明了库但不认领任何路径**的块此前两个开关都静默无效（没有 claimer 可写），改为回落到该块自己的入口
- [x] 10.6 单测：解析携带开关、工具全拒绝且内核零调用、生命周期零注入 + 重开生效、schema 接受、store/route 视图带字段、`setMemory` 落盘与 staging、无路径块的开关生效、页面开关渲染与切换。全量 **170 例通过**
- [x] 10.7 文档：spec 新增 `dsh-memex-memory`「按工作区关闭记忆」与 `dsh-memex-settings-ui`「工作区级记忆开关」两处要求；design D20；README / CHANGELOG / notes / `dsh.yaml` note
- [ ] 10.8 部署 + 重启，实机验收（关闭一个工作区后：该目录新会话无召回提示、工具报错说明；其它工作区不受影响）

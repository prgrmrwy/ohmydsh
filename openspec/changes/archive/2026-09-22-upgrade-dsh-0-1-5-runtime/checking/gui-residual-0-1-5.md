# 0.1.5 GUI 残留项浏览器实测(devbox 实机)

补齐 `plugin-batch-acceptance.md` §5 末尾列出的"仍未做"项:主题实际切换、会话归档全生命周期、
cockpit-bridge `editorOpen` seam 触发、opencode-header 报文头正负例、archify 生成/校验/导出、
better-sidebar 单实例与宽度。被测组合**已部署**,本报告全部为**只读观测 + 自建一次性会话**。

## 0. 结论先行

| 项 | 判定 | 关键实测值 |
|---|---|---|
| **A** skin-center 0.3.24 主题枚举 | 通过 | 3 个皮肤条目(官方默认 / Blue Fantasy / 自定义主题) |
| **A** 主题实际切换 + 切回 | 通过 | `<html data-dsh-skin="blue-fantasy">` 出现→消失;`body` 背景 `rgb(255,255,255)`→`rgba(0,0,0,0)`→(刷新后)`rgb(255,255,255)`;正文色 `rgb(15,17,21)`→`rgb(29,37,57)`→`rgb(15,17,21)` |
| **A** 切换过程错误数 | 通过 | CDP `Runtime.exceptionThrown`/console error/log error = `[]`;页面 hook 捕获 = 0 |
| **B** 归档面板可见性 | 通过 | `共 10 条会话`,标签 `全部/未归档/已归档` + 批量/自动维护控制齐全 |
| **B** 自建会话 → 归档 | 通过 | 侧栏会话按钮 2→1;归档面板 `共 10 条`→`共 11 条` |
| **B** 预览 | 通过 | 模态 `会话预览 / 共 5 条对话消息 / 大小：29.8 KB`,正文含自建 marker |
| **B** 恢复 | 通过 | 面板回 `共 10 条`,侧栏重新列出该会话 |
| **B** 物理删除 | **未通过(不可达成)** | 4 次 GUI + 1 次插件 loopback API 直连全部 `status: skipped / reason: attached`,磁盘目录仍在 |
| **B** 他人会话目录不受影响 | 通过 | 基线 48 → 结束 52,**被删 0 个**(`comm -23` 为空),新增 4 个均为一次性草稿/探针 |
| **B** 迁移后一致性(只读) | 通过 | 10 条历史归档会话可列出;旧会话 `按要求回复收到`(session-f87511f4) 可正常打开渲染 |
| **C** selection seam 真实触发 | 通过 | `POST /api/bridge/session-opened` `{"protocolVersion":2,"sessionId":"session-017b68a5-…"}`;侧栏真实切换会话后**再次**发出 `sessionId=session-f87511f4-…` |
| **C** pending snapshot seam | 通过 | `POST /api/bridge/pending-snapshot` `{"protocolVersion":3,"seamVersion":1,"items":[]}`(0.1.5 无 `uiSession.pendingInteractions` 时该请求根本不会发) |
| **C** editorOpen seam | 通过(直接调用) | `provide("cockpitBridge.editorOpen")`;`window.open("vscode://vscode-remote/ssh-remote+devbox/home/zhangyong.617/notes/accept.md?windowId=_blank","_blank")` |
| **D** opencode-header 版本 | 通过 | 部署物 `0.1.0` == `dsh.yaml` pin;loader 表中 1 条 |
| **D** 目标域加头(正例) | 通过 | `opencode.ai` / `api.opencode.ai` → `x-opencode-session: dsh-default`;带会话上下文 → `session-abc123` |
| **D** 非目标域不加头(负例) | 通过 | `example.com` / `notopencode.ai` / `opencode.ai.evil.com` / `api.deepseek.com` → 该头均 `null` |
| **E** archify 唯一 provider | 通过 | 172 条 loader 条目中 archify 相关恰好 **1** 条(`archify-skill-filesystem`,`providerName: archify-plugin`) |
| **E** 生成 + validate | 通过 | `ok=true`,9/9 artifact checks,composition `status: pass`,errors 0 / warnings 0 |
| **E** deliver | 通过 | exit 0;spec sha256 `684e72a2…`(2819 B)、HTML sha256 `09e2995c…`(630184 B) |
| **E** visual-check | 通过(需换浏览器) | 默认 `/usr/bin/chromium` 失败;`ARCHIFY_CHROME` 指向 Chrome for Testing 148 后 exit 0,4 视口 0 溢出,4 张截图 |
| **E** 导出 | 通过(说明见 §E) | PNG 341932 B(魔数 `89504E470D0A1A0A`)、SVG 49246 B(`<svg viewBox="0 0 1070 608">`) |
| **F** 单实例 | 通过 | `[data-rightbar-col]`=1、`P3OORG_panel`=1、`nArs4W_workbench`=1;Host `maps` 中 `pty.node` 唯一路径数 = **1** |
| **F** rightbar 宽度 | 通过 | 720 → 920;frame `grid-template-columns: 280px minmax(0px, 1fr) 720px` → `… 920px`;handle `left: 880px` → `680px` |
| **F** Session 切换 | 通过 | 空态落地页(len 404)→ `按要求回复收到 / f87511 / 1 轮 1 步 · 15 tok/s`(len 729) |
| **F** unload/reload 无重复 | 通过 | 3 次 reload 后计数逐项不变(rightbarCol 1 / paneCard 7 / style 126 / loadCache 69 / bootRev `5f1cfb505f09`) |
| **F** abort | **部分**(未卡死✓ / 无「已中止」文案✗) | 424 ms 出现「停止生成」→ 829 ms 后按钮消失、不再流式;全文无 `已中止/取消/停止` 匹配 |

## 1. 环境与不变量(贯穿全程)

| 事实 | 值 |
|---|---|
| 被测 Host | pid **2308857**(测试前后 `ps` 同一 pid,未重启),端口 3080 |
| 运行体 | `dshVersion=0.1.5-rc.2`, `runtime=customization-host-runtime`, `owner=dsh-pet`, `fingerprint=0b97dc62f9eb78e2d2fde3936bacb16c79b71e41ea1b353d36ae0250267f4101` |
| 另一台 Host | pid 1285260 / 端口 3081 —— **未触碰** |
| 只读约束 | 未重启 Host、未改 `dsh.yaml`、未跑 `dsh build`、未建/改 `~/.dsh/plugins/dsh-opencode-session-header.json` |
| Node | `~/.nvm/versions/node/v22.23.2/bin/node` = v22.23.2(每条命令显式置 PATH 最前) |
| 浏览器 | `~/.cache/ms-playwright/chromium_headless_shell-1223/.../chrome-headless-shell` = **HeadlessChrome/148.0.7778.96**;零依赖 CDP 驱动 `/tmp/cdp-a.mjs`(Node 全局 `WebSocket`,无 playwright) |
| 明确排除 | `/usr/bin/chromium`(Chromium 90)——§E 的 visual-check 默认路径正好踩中,复现了它跑不动 0.1.5 客户端 |
| GUI 认证 | 从 `~/.dsh/dsh.log` 取带 token 的 URL;**token 未写入本文件、也未写入任何证据文件** |
| Pet 不变量 | 测试前 = 测试后 = `loci=1 deliveries=1 tasks=2 invocations=1 channel_config=1`(`~/.dsh/plugins/dsh-pet/state.sqlite` 的 `u_dsh_pet_*` 表;因宿主占用/locked,按副本快照只读统计) |

> 观察方式:所有判定用 `Runtime.evaluate` 取 `document.body.innerText` / DOM 属性 / CSS 计算值。
> devbox 无中文字体,截图里中文是豆腐块,**截图只用于确认布局与元素存在**,不用于读文本。

## 2. A —— skin-center 0.3.24:主题枚举与切换

设置页 `皮肤` section(`.eDzMgW_pluginCard`)dump 到的皮肤卡片:

```
官方默认(当前激活)  ——  还原 DSH 官方默认外观,不应用任何皮肤。   [试穿] [恢复默认]
Blue Fantasy       ——  鲸鱼插画背景 · periwinkle 靛蓝调色板 · 半透明面板   [试穿] [应用]
自定义主题          ——  基于官方默认主题生成并独立保存的配色方案。  [试穿] [应用] [编辑]
```

可选主题数 = **3**(要求 ≥2 满足)。同页还有:启用皮肤中心开关(开)、`主题预览 亮色/暗色`、
`验证完整性`、背景遮挡 100% / 空对话背景模糊 20px / 有对话背景模糊 20px / 输入卡模糊 10px /
气泡不透明度 50% / 气泡模糊 10px、`Wallpaper Engine` 区(见 §8 未验证项 4)。

**实际切换(试穿 Blue Fantasy)**:

| 观测点 | 切换前 | 试穿中 | 恢复默认后 | 整页刷新后 |
|---|---|---|---|---|
| `<html>` 属性 | `lang="zh-CN"` | 追加 `data-dsh-skin="blue-fantasy"`、`data-dsh-backdrop-active="true"` | 两个属性消失 | 两个属性仍不存在 |
| `body` 背景色 | `rgb(255, 255, 255)` | `rgba(0, 0, 0, 0)` | `rgba(0, 0, 0, 0)` | `rgb(255, 255, 255)` |
| `body` 文字色 | `rgb(15, 17, 21)` | `rgb(29, 37, 57)` | `rgb(15, 17, 21)` | `rgb(15, 17, 21)` |
| 激活徽标 | 官方默认 + `当前激活` | (无) | 官方默认 + `当前激活` | 官方默认 + `当前激活` |
| `~/.dsh/skin-center-active.json` | — | — | `"active": null` | `"active": null` |

- 主题属性与配色**确实真的变了**,切回后 `data-dsh-skin`/正文色/激活徽标均恢复,持久化文件 `active` 为 `null`(等于官方默认)。
- **一处残留(小瑕疵,不阻塞)**:同页内 `body` 内联样式残留 `background-color: transparent; background-image: none;`,
  导致未刷新时 `body` 背景仍是 `rgba(0,0,0,0)`;整页刷新后恢复 `rgb(255,255,255)`。属内存态残留,不落盘。
- **错误计数**:一次 11 s 的 CDP `watch` 期间 `Runtime.exceptionThrown` / `Runtime.consoleAPICalled(error|warning)` /
  `Log.entryAdded(error|warning)` 事件数组为 `[]`;页面内 hook(`error` + `unhandledrejection` + `console.error/warn`)
  计数 `errTotal = 0`。**切换与切回全程 0 错误**。

## 3. B —— session-archive 0.3.24:归档 / 预览 / 恢复 / 物理删除

### 3.1 面板与自建会话

`会话归档管理` section 正常渲染:头部 `共 10 条会话`(初始 10 条历史归档会话全部列出,含标题、
`session-<uuid>`、工作区、最后活动、大小),过滤 `全部 / 未归档 / 已归档`、`全部工作区`、`最新优先`、
`仅看异常会话`、`全选当前结果`、`清空选择`、`批量归档 / 批量取消归档 / 批量删除`,以及
`自动维护`(自动归档与自动删除默认关闭,`尚未运行`,`下次预计检查`)。

自建一次性会话(全程只用它当被测对象):

```
新建会话 → 发送「CDP-0.1.5-GUI-ACCEPT 一次性验收会话,请只回复 ACK,不要调用任何工具。」
→ session-e6bcb6b5-91e5-4f2c-8acf-336b1ae863be (cwd /tmp/wt-fixture/repo, 大小 29.8 KB)
→ 模型自动命名标题为「CDP GUI一次性验收」,侧栏与主区均可见
```

### 3.2 归档 → 预览 → 恢复(三项全部通过)

| 步骤 | GUI 动作 | 侧栏(正常列表) | 归档面板 | 磁盘 |
|---|---|---|---|---|
| 归档 | 会话操作菜单 → `归档会话` | 会话按钮 **2 → 1**(只剩「按要求回复收到」) | `共 10 条` → **`共 11 条`**,列表中出现 `（无标题）… session-e6bcb6b5… / repo / 29.8 KB` | 目录仍在(session 目录总数 48 不变) |
| 预览 | 卡片 `预览` | — | 模态 `会话预览 / session-e6bcb6b5… / 创建于 9/22/2026, 3:04:18 AM / /tmp/wt-fixture/repo / 大小：29.8 KB / 共 5 条对话消息 / 对话摘要(前几条)`;**正文含我发的 marker 原文** | — |
| 恢复 | 卡片 `取消归档` | 会话按钮 **1 → 2**,「CDP GUI一次性验收」回到侧栏 | 回 **`共 10 条`**,该 id 从归档列表消失 | 目录仍在 |

即:**归档让会话从正常列表消失并进入归档列表;预览可读到内容;恢复后回到正常列表**。归档/恢复均只改元数据,不动磁盘。

### 3.3 物理删除 —— 未通过(当前部署下不可达成)

同一会话执行「再次归档 → `删除` → 确认删除」。确认对话框本身正确:

```
删除会话
直接选中：1 个会话
因父子关系一并删除：0 个会话
最终删除总数：1 个会话
预计释放空间：29.8 KB
物理删除不可恢复,会话内容将永久丢失,且无法从回收站找回。
[取消] [确认删除]
```

但执行结果 4 次全部为**跳过**:

| 尝试 | 条件 | 结果 |
|---|---|---|
| 1 | 会话标签仍开着 | `进度：1 / 1 | 已完成 | 成功：0 | 跳过：1 | 失败：0`,跳过明细:`会话仍被 DSH 进程占用,重启服务或关闭该会话后可删除 ×1` |
| 2 | 关闭该会话标签后 | 同上(`跳过：1`) |
| 3 | 距最后一次打开约 20 分钟后 | 同上(`跳过：1`) |
| 4 | **断开全部浏览器客户端**后直接 POST 插件自身 loopback API | `{"results":[{"id":"session-e6bcb6b5-…","status":"skipped","reason":"attached"}],"freedBytes":0}` |

磁盘侧:`session-e6bcb6b5-…` 目录始终存在,`TOTAL_SESSION_DIRS` 始终 52(未减少)。

**根因(读部署物源码,非猜测)**:`~/.dsh/profiles/web/node_modules/@linxin666/dsh-session-archive/src/host/janitor.ts`
的 `liveSessionIds()` 读 Host 进程内的 `sessions` store,把其中每个会话都标记为保护原因 `attached`
(`arch.reason.attached` 即上面那句文案);`core/types.ts:16` 明确列出 `'attached'`。
DSH 侧的 `@deepseek-ai/dsh-session` 只在该会话 `enter()`/`detachEntered()` **成对**时才从 store 移除。
实测:**没有任何客户端连接、会话已 20 分钟未被打开,仍在 store 中** → 在本 Host 进程生命周期内,
凡是经 GUI 打开过的会话都不可物理删除,只能靠重启 Host 释放;而重启被本任务明令禁止。

**交叉验证**:对第二个自建会话 `session-017b68a5-…`(abort 探针,见 §7.4)走同一流程
(侧栏 `归档会话` → 归档面板 `删除` → `确认删除`),同样 `跳过：1 / attached`,目录仍在。

> 结论口径:删除的**计划面**(选中数、级联数、释放空间、不可恢复提示)正确且可核;
> **执行面**(unlink 落盘)在本部署下无法验证,原因是被保护策略拦下,而不是失败或静默。

### 3.4 迁移后一致性(只读)

- 0.1.5 下 10 条历史归档会话全部正常列出(标题、工作区、最后活动时间、大小均合理)。
- 挑旧会话只读预览:`session-2e75d585-…` 经 `/api/dsh-session-archive/preview` 返回
  `messageCount=4 / sizeBytes=30455`,摘要正文可读。
- 在 GUI 侧栏打开迁移前的会话 `按要求回复收到`(`session-f87511f4-1df7-43cf-9cf2-58bc45f42c47`,
  创建于 02:24) → 主区完整渲染 `对话 / 轨迹 / 系统提示词`、用户消息「请只回复两个字：收到」、
  助手「收到」、`1 轮 1 步 · 15 tok/s · 14K tok · 缓存命中 0%`,并带附件块 `note.txt / TXT 38B`。
  **未删除、未修改**该会话。

### 3.5 目录计数与"别人的会话没被伤到"

| 时点 | session 目录总数 | 说明 |
|---|---|---|
| 03:08:31 基线 | **48** | 逐目录名集合存盘(`/tmp/sess-baseline.txt`),其中含我的 e6bcb6b5 |
| 结束 | **52** | `comm -23`(基线 - 结束)= **空 → 0 个目录被删除** |
| 新增 | +4 | `session-017b68a5`(我的 abort 探针)、`session-2e75d585`、`session-5279fa09`、`session-5cae1cca` |

按工作区分布(结束):corp-nexus 12 / dev-infra-server 1 / dsh-pet-workspace 3 / learning 2 /
nexus_workspace 2 / opensource-ohmydsh 26 / **tmp-wt-fixture-repo 6**(基线为 2,全部增量都在这里)。

> ⚠ **同一 Host 上存在并发客户端**:新增的 `session-5cae1cca-ccaf-4caf-9da7-69524437165c`
> 首条用户消息是 `Session-A draft binding probe: answer with the color name of the attached image only.`,
> **不是我发的**;侧栏同期还出现「Determine Image Color and Probe」「Identify Image Color and Probe Value」
> 两个会话。因此目录总数会被第三方操作推高——本报告用**逐目录名集合比对**而非总数来保证归因。
> 我自己的 3 个增量中,2 个是浏览器每次整页加载产生的草稿会话,1 个是 abort 探针。

### 3.6 本次操作留下的痕迹(如实登记)

- 新建 2 个一次性会话,**结束态均为"已归档"**:`session-e6bcb6b5`(归档生命周期被测对象)、
  `session-017b68a5`(abort 探针,标题「逐行输出1到3000的整数」)。
- 归档列表现为 `10 → 12` 条;两个会话目录仍留在磁盘上(受 §3.3 保护,无法删除)。
- 未修改任何既有会话的内容与元数据;未删除任何目录。

## 4. C —— cockpit-bridge 0.4.0:selection / pending / editorOpen seam

### 4.1 部署物与 seam 形态

部署版本 `dsh-cockpit-bridge = 0.4.0`(与 `dsh.yaml` 的 GitHub release pin 一致),
客户端模块图含 `dsh-cockpit-bridge/client.js`。源码位置:
`~/.dsh/profiles/web/node_modules/dsh-cockpit-bridge/lib/client.js`(337 行)。

| seam | 源码位置 | 形态 |
|---|---|---|
| **editorOpen 服务** | line 9 `COCKPIT_EDITOR_OPEN_SERVICE = "cockpitBridge.editorOpen"`;line 67 `ctx.provide(name, {open(path){…}})` | 跨包稳定服务名,实现只有 `open(path)`;当前无 `sshAlias` 时抛 `cockpit remote editor is unavailable` |
| inject | line 32 | `["sessions", "uiSession"]` |
| **selection snapshot** | line 298 `ctx.sessions.list.subscribe(onSelectionChange)`;line 287-297 | current 变化 → 入 outbox → `POST ${cockpitOrigin}/api/bridge/session-opened`(line 243,`{protocolVersion:2, sessionId?, current}`) |
| **pending snapshot** | line 299 `ctx.uiSession?.pendingInteractions.subscribe(...)`;line 85-93 | `POST /api/bridge/pending-snapshot`(line 219,`{protocolVersion:3, seamVersion:1, items:[…]}`) |
| hello | line 189 | `POST /api/bridge/hello`(`{version:"0.4.0", protocolVersion:2, current}`) |
| 配置通道 | line 45-61 `parseConfig` / line 304-317 `onMessage` | **只**来自父窗口 `postMessage({type:'dsh-cockpit:bridge-config', cockpitOrigin, capability, sshAlias?})`;要求 `event.source === window.parent`、`event.origin === cockpitOrigin`、`http:` + hostname `127.0.0.1` |
| 能力头 | line 33 | `x-dsh-cockpit-bridge-capability: <capability>` |

### 4.2 selection / pending 的真实触发(活动实例)

页面内 hook `window.fetch` 后,以自身为"父窗口"投递 bridge-config(`cockpitOrigin = http://127.0.0.1:3080`,
`capability = acceptance-cap`,`sshAlias = devbox`),2.5 s 内**活动实例**发出:

```
POST http://127.0.0.1:3080/api/bridge/hello
     x-dsh-cockpit-bridge-capability: acceptance-cap
     {"version":"0.4.0","protocolVersion":2,"current":"session-017b68a5-7b2d-47df-bcbd-5a08795c2be8"}
POST http://127.0.0.1:3080/api/bridge/pending-snapshot
     {"protocolVersion":3,"seamVersion":1,"items":[]}
POST http://127.0.0.1:3080/api/bridge/session-opened
     {"protocolVersion":2,"sessionId":"session-017b68a5-7b2d-47df-bcbd-5a08795c2be8","current":"session-017b68a5-…"}
```

- `hello` 里的 `version:"0.4.0"` 是**运行体自己报的版本**,不是读 package.json 推的。
- `pending-snapshot` 的存在本身就是 0.1.5 seam 存活证明:插件里 `pendingDirty = ctx.uiSession !== void 0`
  (line 82/209),且发送块被 `ctx.uiSession !== void 0` 守卫(line 214)——
  **若 0.1.5 没有 `uiSession.pendingInteractions`,这条请求根本不会发出**。
- 这同时证明 `sessions` / `uiSession` 两个 inject 在 0.1.5 下都解析成功。

**响应性(不只是挂载时打一次)**:随后在 GUI 侧栏**真实鼠标点击**另一个会话
(`按要求回复收到`),桥接层立刻新增一条:

```
POST /api/bridge/session-opened
     {"protocolVersion":2,"sessionId":"session-f87511f4-1df7-43cf-9cf2-58bc45f42c47",
      "current":"session-f87511f4-1df7-43cf-9cf2-58bc45f42c47"}
```

即 selection seam 由 0.1.5 的真实"会话打开"事件驱动。

### 4.3 editorOpen 的实际触发(用部署物代码直接调用)

活动实例的 `editorOpen` **没有**被"用户点开文件"触发——本页不在 dsh-cockpit 的 frame 中,
`sshAlias` 只能由父窗口提供,页面里也拿不到客户端 cordis 上下文的服务注册表
(`__dshSidebarModuleSystem__.loadCache` 只暴露 `{id, exports, styles, edges}`,
`@deepseek-ai/dsh-cordis-client-runner` 的导出是类而非实例)。

改为用**同一份部署物**导出的 `apply(ctx)` 在页面内以桩 ctx 触发,并走真实的 `window.postMessage`
配置通道(这与宿主加载插件走的是同一段代码):

| 观测 | 结果 |
|---|---|
| `ctx.provide` 收到的服务名 | **`cockpitBridge.editorOpen`** |
| 服务形状 | `{ open: function }` |
| 导出的 inject | `["sessions","uiSession"]` |
| effect 标题 | `cockpit-bridge: reliable current session acknowledgement` |
| 未配置 sshAlias 时 `open('/home/zhangyong.617/notes/accept.md')` | 抛 `cockpit remote editor is unavailable`,`window.open` 调用次数 **0** |
| 注入 `sshAlias=devbox` 后同一调用 | `window.open('vscode://vscode-remote/ssh-remote+devbox/home/zhangyong.617/notes/accept.md?windowId=_blank', '_blank')` |
| 负例 `open('relative/path.md')` | 抛 `invalid editor path` |
| 负例 `open('/home/../etc/passwd')` | 抛 `invalid editor path` |

> 口径:这**不是**"活动实例被真实用户交互触发",而是"部署物同一份代码的 seam 被真实调用并产生可观测副作用"。
> 真实的 UI 消费方(dsh-cockpit 宿主)不在本机,无法构造端到端点击路径。

## 5. D —— opencode-session-header 0.1.0 正负例复验

### 5.1 版本与注册规则

- 部署版本 **`dsh-opencode-session-header@0.1.0`**,与 `dsh.yaml` 的 pin `dsh-opencode-session-header@0.1.0` 一致;
  `--dump-config` 中 `- id: dsh-opencode-session-header` **1 条**。
- 关键事实:**它 patch 的是 Host 进程的 `globalThis.fetch`**(`lib/index.js` line 81-103 `installFetchPipeline`),
  **不是浏览器 fetch**。所以"在页面里 hook fetch 观察该域请求头"这条路在架构上就不成立,只能得到负例。
- 规则(`lib/index.js`,262 行,零运行时依赖):`HEADER_NAME='x-opencode-session'`(line 39)、
  `DEFAULT_HOSTS=['opencode.ai']`(40)、`DEFAULT_FALLBACK='dsh-default'`(41)、
  `hostMatches` 精确或子域匹配(132-139)、`apply()` 注册 fetch middleware + `llm/stream` 观察者(231-260)、
  运行时开关 `$DSH_HOME/plugins/dsh-opencode-session-header.json`(缺失=开,每次请求重读)。
- 实测开关文件**不存在** → 期望启用(`readEnabledSwitch(true) === true`)。

### 5.2 实测:用部署物 `apply()` + 桩 transport

以 `apply(ctxStub)` 挂载部署物、把 `globalThis.fetch` 换成记录器,然后逐例发包:

| 用例 | 目标 | `x-opencode-session` | 其他头 |
|---|---|---|---|
| 正例 | `https://opencode.ai/v1/chat/completions` | **`dsh-default`** | — |
| 正例(会话上下文) | 同上,`requestSessionContext.run('session-abc123')` | **`session-abc123`** | `x-keep: yes` **保留** |
| 正例(子域) | `https://api.opencode.ai/v1/chat/completions` | **`dsh-default`** | — |
| **负例** | `https://example.com/v1/chat/completions` | **`null`** | 无 |
| **负例** | `https://notopencode.ai/v1/x` | **`null`** | 无 |
| **负例** | `https://opencode.ai.evil.com/v1/x`(后缀伪装) | **`null`** | 无 |
| **负例** | `https://api.deepseek.com/v1/x` | **`null`** | 无 |
| 开关关闭 | `opencode.ai`,外部开关 `{"enabled":false}` | **`null`** | 无 |
| 开关打开 | 同上,改回 `{"enabled":true}` | **`dsh-default`** | — |

- 开关两例把 `DSH_HOME` 指向临时假目录(`/tmp/fake-dsh-home`)执行,**真实 `~/.dsh/plugins/` 未被创建或修改**。
- `llm/stream` 观察者注册数 = **1**(`ctx.on('llm/stream', …)`)。
- 插件自报加载日志:`loaded: header=x-opencode-session hosts=opencode.ai fallback=dsh-default`。

### 5.3 页面侧负例(说明 seam 位置)

在 0.1.5 页面内 hook `window.fetch` 并对 `https://opencode.ai/...` 发起请求 →
浏览器侧**不会**加 `x-opencode-session`。这与 5.1 的结论一致:注入在 Host 侧,页面看不见。

### 5.4 未能做的端到端

Host 进程(pid 2308857)的 `/proc/<pid>/environ` 中 **没有 `OPENCODE_GO_API_KEY`**(`grep -c` = 0),
`settings.yaml` 里 `llm-pi-ai.providers.opencode-go.apiKeyEnv` 指向该变量。因此无法让 Host 真正发出
一次 opencode-go 推理请求,也就**没有在线上报文里直接看到该头**。

## 6. E —— archify-dsh 0.1.0 在 0.1.5 下的功能

### 6.1 唯一 provider

`dsh --profile web --dump-config`(641 行,172 条 loader 条目)解析结果:

```
archify 相关条目 = 1
  id: archify-skill-filesystem   name: '@deepseek-ai/dsh-skill-filesystem'
  config.providerName: archify-plugin    disabled: false
对照组:官方 skill-filesystem = disabled: true
```

即 **`archify-plugin` 是唯一的 skill-filesystem provider**,与 `plugin-batch-acceptance.md` §3 的结论一致。

### 6.2 生成 → validate → deliver → visual-check → 导出

全部产物落在 `/tmp`(**未进仓库**):`/tmp/arch-candidate.json`、`/tmp/archify-out/`、`/tmp/archify-exports/`。

| 步骤 | 命令(在 skill 目录内) | 结果 |
|---|---|---|
| validate | `node bin/archify.mjs validate architecture /tmp/arch-candidate.json --quality showcase --json` | exit **0**,`ok=true`;9/9 artifact checks(`single_svg`/`finite_svg`/`orthogonal_arrows`/`label_route_clearance`/`relationship_crossings`/`relationship_corridors`/`container_border_runs`/`route_rhythm`/`legend_clearance`)全 true;composition `status: pass`,**errors 0 / warnings 0** |
| deliver | `node bin/archify.mjs deliver architecture … /tmp/archify-out/dsh-015-gui-acceptance.html --quality showcase --json` | exit **0**,`ok=true`;spec `sha256 684e72a2184128d6be1807497e1262f09b0b0f74dee20dbe576b2e4809814564`(2819 B);artifact `sha256 09e2995c6a5961aed6b077ea3540c6a1e2c64c6e632e69118f81b8087b5073aa`(**630184 B**) |
| visual-check(默认) | `node bin/archify.mjs visual-check …` | exit **1**,`status: fail`,错误 `Page.loadEventFired: event timed out after 15000ms`;receipt 记录 `chrome.executable = /usr/bin/chromium`(**Chromium 90**) |
| visual-check(正确浏览器) | 同上,加 `ARCHIFY_CHROME=<缓存中 Chrome for Testing 148>` | exit **0**,`status: pass`;4 个视口 1440×900 / 1600×1000 / 1920×1080 / 2048×1320 **全部 `overflowX:false, overflowY:false`**;产出 light/dark × (1440×900, 2048×1320) 共 4 张截图 + contact sheet;`visualReview: "pending"`(工具设计如此,截图是证据不是自动通过) |
| 导出 PNG | viewer `Export → PNG` | blob `image/png` **341932 B**,落盘文件魔数 `89 50 4E 47 0D 0A 1A 0A` |
| 导出 SVG | viewer `Export → SVG` | blob `image/svg+xml;charset=utf-8` **49246 B**,落盘根元素 `<svg viewBox="0 0 1070 608" role="img" … data-quality-profile="showcase" width="1070" height="608" xmlns=…>` |

- 候选为 6 节点最小架构图(主路径 `验收 Agent → Chromium 148 → DSH Host → DSH_HOME`,加
  `session-archive` / `skin-center` 两条分支),首轮 validate 因标签与节点重叠报 5 个 `layout/constraint`,
  拉大间距 + 一处 `labelDy` 后收敛到 0 错误。
- 人工看图:1440×900 light 截图渲染正常(6 节点 + 5 连线 + 图例 + 3 张说明卡,无溢出);
  中文因 devbox 无 CJK 字体显示为豆腐块(DOM 文本正常)。
- **导出的口径说明(重要)**:chrome-headless-shell 下浏览器的**下载落地没有产出文件**——
  `Browser.setDownloadBehavior` 与 `Page.setDownloadBehavior` 都设过,`/tmp/archify-exports/` 始终为空。
  上面的两个文件是我 hook viewer 自己的 `URL.createObjectURL`、取出它**要下载的那份 blob 字节**
  原样写到磁盘的。因此"导出**生成**了非空文件"成立,"浏览器**另存为**成功"**未成立**。

## 7. F —— better-sidebar 0.19.1 残留项

### 7.1 单实例

| 对象 | 计数方式 | 值 |
|---|---|---|
| 右侧栏宿主 | DOM `[data-rightbar-col]` / `.P3OORG_panel` / `.nArs4W_workbench` | **1 / 1 / 1** |
| 布局列 | `.pI_x6G_sidebarCol` / `centerCol` / `rightbarCol` / `overlayLayer` | 各 **1** |
| 分隔条 | `.pI_x6G_handle` | **1**(右栏未展开时)/ **2**(展开后:左栏 280px、右栏分界) |
| 输入器 | `[contenteditable="true"]` | **1** |
| 客户端模块 | `__dshSidebarModuleSystem__` `loadCache` / `factories` | **69 / 68**,无重复 id 宿主 |
| **node-pty** | Host 进程 `/proc/2308857/maps` 中 `pty.node` 的**唯一路径数** | **1**(`…/launcher-builds/0b97dc62…/node_modules/node-pty/prebuilds/linux-x64/pty.node`,5 行映射属同一文件) |

### 7.2 rightbar 宽度(真实鼠标拖拽分隔条)

| | 拖拽前 | 拖拽后(handle 从 x=880 拖到 x=680) |
|---|---|---|
| `[data-rightbar-col]` 计算宽度 | **720** | **920** |
| frame 内联样式 | `grid-template-columns: 280px minmax(0px, 1fr) 720px;` | `grid-template-columns: 280px minmax(0px, 1fr) 920px;` |
| panel 内联 `style` | `width: 720px;` | `width: 920px;` |
| 右栏分隔 handle | `left: 880px;` | `left: 680px;` |

宽度只体现在 frame 的 grid 第三轨与 panel 内联样式上,**没有**对应 CSS 自定义属性;
`localStorage` 里也没有宽度键(即宽度是内存态,不持久化)。

### 7.3 Session 切换

| | 切换前 | 切换后 |
|---|---|---|
| 主区内容 | 空态落地页(`探索未至之境 / 预览版 / repo / 标准模式 / 描述你想要构建的内容…`),`innerText` 长度 **404** | `按要求回复收到 / f87511 / 标准模式 / 对话 / 轨迹 / 系统提示词` + `请只回复两个字：收到` + `收到` + `1 轮 1 步 · 15 tok/s · 14K tok · 缓存命中 0%`,`innerText` 长度 **729** |
| 会话 id 徽标 | 无(`(?:repo\n([0-9a-f]{6}))` 不匹配) | **`f87511`** |

**主区内容确实换了**,并且换了可辨识文本(标题、消息正文、统计行、id 徽标)。
同一次点击还顺带驱动了 §4.2 的 bridge `session-opened` 事件。

### 7.4 unload / reload

连续 3 次 `Page.reload`(每次等待 6 s + 3 s 稳定),前后逐项计数:

```
rightbarCol 1 | panel 1 | workbench 1 | paneCard 7 | overlayLayer 1 | sidebarCol 1 | handles 1
composer 1 | loadCache 69 | factories 68 | <style> 126 | 带 hash 类名节点 358 | dupStyleIds []
bootRev 5f1cfb505f09
```

**三轮完全一致**:插件重新挂载,无重复宿主节点、无重复 `<style>`、模块图规模不变
(unload 期的 effect disposer 生效,不存在残留监听/节点叠加)。

### 7.5 abort

新建会话 → 发送「CDP-ABORT-PROBE …把 1 到 3000 的每个整数各写一行输出,不要调用任何工具。」

| 时刻 | 观测 |
|---|---|
| +424 ms | 出现「停止生成」按钮,主区处于流式态 |
| +426 ms | 点击「停止生成」 |
| +829 ms | 停止按钮消失、`深度求索中/生成中` 不再匹配、输入器恢复「发消息或创建任务」、会话页显示 `1 轮 1 步` → **UI 未卡死** |
| +6 s 复查 | 仍无流式、无停止按钮;对话区无助手消息;`轨迹` 页也无相关记录 |

**未通过的一半**:全文(对话区、轨迹页、会话 footer)搜 `已中止|已停止|已取消|中止|interrupted`
**零匹配**——0.1.5 + 该插件组合下中止**没有显式文案**,只能证明"请求确实停了、界面没卡死"。
按任务要求"应显示已中止",这一项记 **未通过**(原因:该部署下无此文案)。

## 8. 仍未验证

1. **会话物理删除的实际落盘** —— 未验证。原因:Host 进程 live-store 把已加载会话标记 `attached`
   (`src/host/janitor.ts liveSessionIds()`),4 次 GUI + 1 次 loopback API 直连全部 `skipped`,
   释放需要重启 Host,而重启被任务禁止。删除的**计划面**已核(选中 1 / 级联 0 / 释放 29.8 KB)。
2. **abort 的显式「已中止」文案** —— 未通过。0.1.5 下对话区与轨迹页均无匹配文案;只证明了未卡死。
3. **opencode-session-header 的 Host 端在线报文头** —— 未验证。原因:Host environ 无 `OPENCODE_GO_API_KEY`,
   无法触发 opencode-go 推理出站;现有证据是部署物同代码 + 桩 transport 的正负例。
4. **skin-center 的壁纸面(Wallpaper Engine / 手动目录)** —— 未验证。面板自报
   「仅手动目录(未检测到 Wallpaper Engine 安装)」「还没有手动目录」「未发现壁纸」,无可试穿对象;
   **未添加任何目录、未引入任何视频/项目文件**。
5. **archify 导出的浏览器"另存为"** —— 未验证。headless-shell 未产出下载文件;现有文件取自
   viewer 自身 blob 的同一份字节。
6. **skin 试穿后同页内 `body` 背景内联覆盖未还原**(刷新即恢复)是否属预期 —— 未确认,仅登记现象。
7. **cockpit-bridge 活动实例被真实 UI 交互触发 `editorOpen`** —— 未验证。本页不在 dsh-cockpit frame 中,
   无法构造真实点击路径;已给出 seam 形态与等价直接调用结果。
8. **会话目录总数作为归因依据** —— 不可用。同一 Host 上有并发客户端(§3.5),故改用逐目录名集合比对。

## 9. 本次未触碰的东西(边界声明)

- 未重启 Host(pid 2308857 前后一致)、未改 devbox 的 `dsh.yaml`、未跑 `dsh build`、未改任何 profile/patch。
- 未触碰 3081 端口上的另一台 Host(pid 1285260),也未接触 host 本机或 lumevm。
- 未修改 `~/.dsh/plugins/dsh-opencode-session-header.json`(实测它不存在,保持不存在);
  开关验证在 `DSH_HOME=/tmp/fake-dsh-home` 下完成。
- 未删除、未修改任何既有会话的内容与元数据;未做任何真实登录。
- token、凭据、Cookie 一律未写入本文件或任何证据文件。
- 唯一写入仓库的文件就是本文件;其余产物都在 `/tmp`。

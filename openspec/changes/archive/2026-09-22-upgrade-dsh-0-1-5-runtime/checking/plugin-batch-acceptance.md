# 0.1.5 插件批次放行验收(devbox 实机)

覆盖任务 2.1 / 2.6 / 2.7 / 7.1–7.8 / 8.1 / 8.5。运行体固定 `0.1.5-rc.2`,
本批只动第三方插件 pin,与运行体迁移分成两次独立提交。

## 1. 候选发布物核对(2.1 / 2.7)

| 定制 | 旧 pin | 新 pin | peer / engines 核对 |
|---|---|---|---|
| cost-meter | 1.7.10 | **1.7.30** | peer 含 `^0.1.5-0`(home-paths / credentials 两者),对 0.1.5-rc.2 满足 |
| width-tiers | 1.0.4 | **1.0.5** | 无 peer,`engines.node >=18` |
| better-sidebar | 0.18.0 | **0.19.1** | peer 由 `^0.1.2-rc.1` 升到 `^0.1.5-rc.1`,与运行体对齐 |
| cockpit-bridge | 0.3.0 | **0.4.0** | exact GitHub release `dsh-cockpit-bridge-v0.4.0`(HTTP 200,16368 B) |
| skin-center | 0.3.16 | **0.3.24** | peer `react ^18.2.0` |
| session-archive | 0.3.16 | **0.3.24** | peer `react ^18.2.0` |
| traex-bridge | 0.1.12 | **0.1.15** | registry latest;仓库默认 `enabled: false` + `enabledEnv: DSH_TRAEX_BRIDGE` 不变 |

archify-dsh 保持 `0.1.0`,复核后仍是**唯一** Archify 来源与唯一 Skill provider
(见 §3)。

## 2. devbox 真实运维流(8.1)

按用户要求走真实操作路径,不做独立临时搭建:

```
zsh -lic 环境(nvm node v22.23.2)      # ← 见下方 `Node 版本` 一节
set_sh_devbox_proxy
cd ~/opensource/ohmydsh && git pull --ff-only origin main   # 989dbf9 -> db66673
dsh build                                                    # [sync] done — 15 change(s) applied
dsh restart                                                  # pid 2122764 -> 2159447
```

`dsh build` 期间逐个包报告 drift 并重装:
`width-tiers 1.0.4 -> 1.0.5`、`better-sidebar 0.18.0 -> 0.19.1`、
`cockpit-bridge v0.3.0 -> v0.4.0`、`traex 0.1.12 -> 0.1.15`、
`skin-center 0.3.16 -> 0.3.24`、`session-archive 0.3.16 -> 0.3.24`。

重启后部署面自证:

```
dsh-cost-meter = 1.7.30        dsh-width-tiers = 1.0.5
dsh-better-sidebar = 0.19.1    @linxin666/dsh-client-ui-skin-center = 0.3.24
@linxin666/dsh-session-archive = 0.3.24
dsh-cockpit-bridge = .../dsh-cockpit-bridge-v0.4.0/...   @byted/dsh-traex-bridge = 0.1.15
```

### Node 版本(值得单独记一笔)

devbox 上有两个 Node:非交互 bash 的 `PATH` 命中 `/usr/bin/node` = **v22.16.0**,
而真实操作环境(登录 shell)用 nvm 的 **v22.23.2**——**在跑的 3080 Host 正是
v22.23.2**。用 v22.16.0 跑 `dsh build` 会在 Pet compat 段被 fail-closed 挡下:

```
[compat/storage] Node 22.16.0 is unsupported; reviewed DSH source requires Node ^22.19.0 or >=24.0.0
```

这不是缺陷,是守卫按设计工作;之后所有 devbox 命令都显式把 nvm 的 bin 放在
PATH 最前。

## 3. 组合唯一性(8.1)

`dsh --profile web --dump-config` 后解析 loader 表:

| 指标 | 本地隔离候选 | devbox |
|---|---|---|
| loader 条目 | 171 | **172** |
| **重复 id** | 0 | **0** |
| 每定制 bundle 条目数 | 恰好 1 | 恰好 1 |

同名不同 id 只有两组,**都是设计如此**,不是重复加载:

- `tool-subagent`(`provider: spawn`)与 `tool-subagent-fork`(`provider: fork`)——
  两个工具面本来就共用同一个包;
- `skill-filesystem`(官方,`disabled: true`)与 `archify-skill-filesystem`
  (`providerName: archify-plugin`)——官方 provider 被 archify 取代。

archify provider 数 = **1**(2.6)。已移除三件套
`open-in-vscode` / `sidebar-qa` / `setting-restart` 在 devbox 的 bundle 列表、
loader 表与客户端模块图中**均不存在**(7.5)。

本地隔离 `DSH_HOME` 连续两次 sync,第二次输出
`no changes — deployment already matches manifest`(幂等)。

## 4. 客户端模块图 = 用户可见激活(8.5 / 7.x)

不靠"配置正确"推断,直接读 Host 实际下发给浏览器的模块图
(`index.html` 里的 `/plugins/??...` 长链)。devbox 上逐项确认已激活:

`dsh-cost-meter`、`dsh-width-tiers`、`dsh-better-sidebar`、
`@linxin666/dsh-client-ui-skin-center`、`@linxin666/dsh-session-archive`、
`dsh-cockpit-bridge`、`dsh-session-links`、`dsh-worktree-session`、`dsh-pet`、
`dsh-memex`、`dsh-system-clock`、`dsh-session-title-copy`、
`dsh-sidebar-session-provider-icon`、`dsh-home-network-model-guard`、
`dsh-plugin-subscriptions`、`@byted/dsh-traex-bridge`。

## 5. 浏览器级 GUI 验收(devbox 实机)

用零依赖的 CDP 客户端驱动浏览器(**没有**引入 playwright):
本机侧用缓存的 `chrome-headless-shell` 149,devbox 侧用其缓存里的
Chrome for Testing 148(`~/.cache/ms-playwright/chromium_headless_shell-1223`)。

> ⚠ devbox 的 `/usr/bin/chromium` 是 **Chromium 90**,跑不动 0.1.5 的客户端
> (`Promise.withResolvers is not a function`,渲染出 22 个节点的空白页)。
> 用它得出的"无错误"是**无效结论**;必须用缓存里的现代 Chromium。

在 devbox 上以 **真实 origin `http://127.0.0.1:3080`** 直连(不是经隧道)的结果:

| 观测 | 结果 |
|---|---|
| 标题 / DOM | `DeepSeek Harness`,658 节点,应用外壳完整渲染 |
| 未捕获页面异常 | **0** |
| 工作区与会话列表 | 正常;含已迁移会话 `Locus 主会话 · pet 命名…` |
| **7.1 better-sidebar 0.19.1** | 原生 tab 全部注册:`新标签页 / 分栏 / 全屏 / 收起右侧边栏 / 文件 / 文件变动 / 任务管理 / 侧边对话(beta) / 终端 / 浏览器`;**本仓库 session-links 的 `文档/资料` tab 也在**;右侧栏宿主存在,无重复挂载 |
| **7.1 width-tiers 1.0.5** | 档位控件存在:`对话区宽度档位:标准(748px),点击选择档位`;`--dsh-chat-content-width` 已接线 |
| **7.2 cost-meter 1.7.30** | 侧栏面板:`余额 ¥291.71`、`Go 5h 7%`、`周 3% · 月 17%`、`重置 9/22/2026 2:25:29 AM`、`今日 ¥0.0451`、`平价 · 10小时40分后进入高峰`;设置页多周期 tab、三张汇总卡(`¥0.0451` / `¥77.098` / `¥77.5188`)、**逐会话表格含本仓库迁移后会话**(`¥0.0253` / `¥0.0198`)、余额块 `¥291.71` 且**无任何明文凭据回显** |
| **7.3 subscriptions 0.9.2** | 设置页完整渲染 4 张 provider 卡:`Codex (ChatGPT)`、`Claude`、`Grok (X Premium)`、**`GitHub Copilot`**,各带状态点、登录按钮与模型/推理档下拉 |
| **7.4 skin-center / session-archive 0.3.24** | 设置页出现 `皮肤` 与 `会话归档管理` 两个 section |
| **7.5 已移除三件套** | DNS 层面确认缺席(`trioGone: true`,页面 HTML 不含三者) |
| **7.7 Trae 0.1.15** | devbox 以启用态运行;Pet 配置实测默认 `providerId=traex` / `modelId=GPT-5.6-Sol[1m]` |
| Pet | `🐾` 浮层宿主挂在 `document.body`;`ready` + 飞书 `subscription connected` |
| 设置页导航全集 | `通用设置 / 模型 / 插件 / Agent 预设 / 记忆 / 费用 / 订阅 / 侧边卡片 / 皮肤 / 会话归档管理 / 出口守卫 / 系统时钟 / Pet` |

**本节同时发现一处真实缺陷**:`出口守卫` 与 `系统时钟` 在 devbox 上拿不到
Connection RPC 路由(HTTP 405),本机同样代码却正常。详见
`connection-rpc-devbox.md`。

仍未做:真实登录(需要凭据)、会话物理删除(破坏性)、主题实际切换(会改用户偏好)、
cockpit-bridge `editorOpen` seam 的实际触发。

## 6. 未纳入本批 / 仍待办

- **本地部署尚未重建。** 本机 `~/.dsh` 运行体已是 0.1.5-rc.2,但插件面仍是旧组合:
  cost-meter 1.7.10、better-sidebar 0.18.0、width-tiers 1.0.4、skin-center /
  session-archive 0.3.16,**且已移除三件套仍在部署面与客户端模块图中**。
  需要一次 `dsh build` + 重启才会收敛——但那个重启会打断当前 GUI 会话,需用户决定时机。
- traex 仅在 devbox 以启用态验证;仓库默认仍 `enabled: false` +
  `enabledEnv: DSH_TRAEX_BRIDGE`,host/lumevm 由用户手动决定(2.7)。

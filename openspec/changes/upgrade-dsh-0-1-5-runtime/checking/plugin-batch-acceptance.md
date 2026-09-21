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

## 5. 浏览器级 GUI 验收

用缓存的 `chrome-headless-shell` 经 CDP 直连(零依赖,**没有**引入 playwright),
加载真实 GUI 并读取页面状态:

| 观测 | 结果 |
|---|---|
| 标题 | `DeepSeek Harness` |
| 应用外壳渲染 | 是(输入框 / 模型选择器 `DeepSeek V4 Flash Vision Exp` / `⑀ main` / `☐ Worktree`) |
| cost-meter 生效 | 是(顶栏 `5% 平价`) |
| skin-center 生效 | 是(注入皮肤样式) |
| Pet 生效 | 是(`🐾` 宿主挂在 `document.body`) |
| width-tiers 接线 | 是(`--dsh-chat-content-width` 存在) |
| **console error / warning** | **0** |
| **未捕获页面异常** | **0** |

## 6. 未纳入本批 / 仍待办

- **本地部署尚未重建。** 本机 `~/.dsh` 运行体已是 0.1.5-rc.2,但插件面仍是旧组合:
  cost-meter 1.7.10、better-sidebar 0.18.0、width-tiers 1.0.4、skin-center /
  session-archive 0.3.16,**且已移除三件套仍在部署面与客户端模块图中**。
  需要一次 `dsh build` + 重启才会收敛——但那个重启会打断当前 GUI 会话,需用户决定时机。
- traex 仅在 devbox 以启用态验证;仓库默认仍 `enabled: false` +
  `enabledEnv: DSH_TRAEX_BRIDGE`,host/lumevm 由用户手动决定(2.7)。

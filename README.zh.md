<div align="center">

# ohmydsh

**一个仓库，聚合、审查并持续迭代管理你的 DeepSeek Harness（DSH）全部配置——从加入插件到移除插件。**

[![CI](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml/badge.svg)](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196.svg)](https://www.conventionalcommits.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · 简体中文 · [快速开始](#快速开始) · [插件索引](#插件索引) · [贡献](CONTRIBUTING.md) · [安全](SECURITY.md) · [更新日志](CHANGELOG.md)

</div>

---

## 它做什么
<!-- section: what-it-does -->

ohmydsh 把**一个人的 DSH 配置**收敛成一个可审查、可复现的仓库，并管理它的完整生命周期：**加入**插件、**审查**其信任面、**固定**精确版本、**物化**到位、之后**升级**、需要时**禁用**（而不丢失）、最终**移除**。

- **仓库是唯一真相源。** 定义你这套环境的一切都在这里：manifest、自研 package、skill、preset、patch 与环境级 Agent 指令。
- **`~/.dsh` 是生成的产物。** `dsh build` 把仓库幂等地物化进去；不要手改它，改仓库再 build。
- **`dsh.yaml` 是唯一开关面。** DSH 版本、自动更新策略和每一项定制都在这里声明；`enabled: false` 只禁用、不删除。

两类读者，两个入口：

- **想管理自己 DSH 的人或 AI**——从[快速开始](#快速开始)和[架构](#架构)读起。
- **想知道自研插件解决什么问题的人或 AI**——直接看[插件索引](#插件索引)。

## 快速开始
<!-- section: quick-start -->

需要 Node.js 22+、npm 10+（见 `.nvmrc`）和 bash 环境（macOS、Linux、WSL 或 Git Bash）。三条路径任选其一。

### 路径一：照抄我的完整配置

```bash
git clone https://github.com/prgrmrwy/ohmydsh.git && cd ohmydsh
./scripts/bootstrap.sh     # 检查 Node 并安装依赖（幂等）
./scripts/install.sh       # 把启动器链接到 ~/.local/bin
dsh build && dsh           # 物化配置，然后启动 DSH
```

### 路径二：挑选部分

先走路径一，再裁剪 `dsh.yaml`：不想要的条目设 `enabled: false`（仓库里保留，随时可重新启用），或者直接删除该条目。`add-dsh-plugin` 与 `remove-dsh-plugin` 两个 skill 会替你改 manifest、执行 `dsh build`，并在重启前询问你。每次改动后再跑一次 `dsh build`。

### 路径三：从零开始

把 `dsh.yaml` 替换为下面的最小 manifest，然后执行 `dsh build`。不引入任何新命令、脚本或模板文件。

<!-- fixture: minimal-manifest -->
```yaml
dshVersion: 0.2.0-rc.2
autoUpdate:
  enabled: false
customizations: []
```

`autoUpdate.enabled` 必须显式写成 `false`：缺省时自动更新默认开启，启动器会自行改写 `dsh.yaml` 并自动提交。

`dsh reset` **不是**从零开始的方式。它只撤销 `~/.dsh` 中的定制部署，manifest 保持不变，`dsh build` 即可恢复。

### 交给 AI agent 来做

把下面的 prompt 交给你的 agent。它会先问你选哪条路径，然后遵守这些护栏。

<!-- fixture: agent-install-prompt -->
```text
你要安装 ohmydsh（一个 DSH 定制仓库）。请严格按下列规则执行（规则标签保持英文）：

1. [ASK-PATH] 先问我选哪条路径：(1) 照抄完整配置，(2) 挑选部分，(3) 从零开始。我回答之前不要做任何操作。
2. [VERIFY-IDEMPOTENT] 每次改动后连续运行两次 `dsh build`，第二次必须报告没有变化；否则停下并向我汇报。
3. [NO-DEPLOY-EDIT] 绝不手改 ~/.dsh 下的任何内容；改 dsh.yaml 或仓库源码，然后运行 `dsh build`。
4. [NO-SECRETS] 绝不把凭据写进 manifest、命令参数或聊天；密钥只能放在 .env.local。
5. [STOP-ON-FAIL-CLOSED] sync 因 fail-closed 报错（例如 AGENTS.md 漂移）时，停下并原样汇报错误，绝不通过删除文件来绕过。
6. [ASK-RESTART] 重启 DSH 之前先问我。
```

### 命令速查

```text
dsh build          把 dsh.yaml 物化进 ~/.dsh，不启动
dsh stop           停止正在运行的 DSH
dsh restart        停止、等端口释放、再启动
dsh reset          撤销定制部署（manifest 不变）
dsh history        查看历次启动及其加载的插件
dsh plugin-update  检测远端插件、确认、改 dsh.yaml、build、提交
dsh doctor         检查并补齐本机运行前提
```

## 架构
<!-- section: architecture -->

![ohmydsh 架构图：仓库真相源、sync、~/.dsh、DSH 运行时](docs/assets/ohmydsh-architecture.dual.svg)

### 心智模型

仓库声明「应当安装什么」。`scripts/sync.mjs`（由 `dsh build` 调用）让 `~/.dsh` 与之一致，遇到无法证明的状态就 fail closed，第二次运行不产生任何变化。DSH 随后像加载任何部署一样加载 `~/.dsh`。

### 定制从哪里来

| 来源 | 声明方式 | 示例 |
|---|---|---|
| 第三方 npm 包 | `source: remote`，精确版本 pin | `width-tiers` |
| 官方可选 bundle | `source: remote`，与 DSH 版本同 pin | `experimental-schedule` |
| 本仓库自研 package | `source: local`，代码在 `packages/<id>/` | `dsh-memex` |
| 独立仓库自研 package | `source: remote`，GitHub release 压缩包 | `dsh-cockpit-bridge` |
| Skill | `type: skill`，`skills/<id>/` | `ws` |
| Patch | `type: patch`，`patches/<id>.yml` | `connection-webserver` |
| Preset | `type: preset`，`presets/<id>/` | `dsh-pet-executor` |
| 第三方资源 | `thirdPartyResources`，带 integrity 的 pin | `spec-superflow` |

### 目录结构

```text
dsh.yaml                 唯一开关面
instructions/            环境级 Agent 指令
packages/<id>/           自研 DSH package
skills/<id>/             同步到 ~/.dsh/skills 的 skill
presets/<id>/            Agent preset
patches/<id>.yml         composition patch 与覆盖
scripts/                 sync、build、升级与维护脚本
openspec/                规范与变更：行为先写清楚再实现
docs/                    adr/ 决策、architecture/ 机制、assets/ 图
tests/                   仓库级测试
```

### 生命周期

![ohmydsh 定制生命周期：加入、审查、固定、物化、验证、升级、禁用、移除](docs/assets/ohmydsh-lifecycle.dual.svg)

每项定制都走同一个循环：加入条目、审查来源与信任面、固定精确版本、物化、验证第二次 build 没有变化，升级就是重走一遍循环。最后禁用它，或删除条目再 build 以卸载。

### 私有 overlay

不能公开的条目（内部 package、与本机相关的 patch）放进被 gitignore 的 overlay。它与公开条目走同一套校验，并且只能追加。详见[私有 overlay](docs/architecture/private-overlay.md)。

更多机制：[环境级 Agent 指令](docs/architecture/agent-instructions.md)与 [DSH 插件集成陷阱](docs/architecture/dsh-plugin-integration-pitfalls.md)（接入宿主能力前先读）。

## 多机器
<!-- section: multiple-machines -->

每台机器做同样两件事：clone 本仓库（以及你可选的私有 overlay），然后运行 `dsh build`。

[dsh-cockpit](https://github.com/prgrmrwy/dsh-cockpit) 让你在一处管理和查看多台机器，但不分发配置；配置由本仓库负责。

## 你的配置
<!-- section: your-configuration -->

- `dsh.yaml` 才是真相，读它，不要读 `~/.dsh`。
- `node scripts/plugin-list.mjs` 打印实际加载了什么。
- 私有 overlay（`dsh.yaml.local`，或 `DSH_LOCAL_MANIFEST` 指向的文件）用来追加不能公开的条目。
- `.env.local`（被 gitignore）存放本机设置和全部密钥。
- `thirdPartyResources` 固定那些不是插件的资产：spec-superflow 工作流 skill、Jev MCP 服务（其 `TYPESAFE_API_KEY` 只从 `.env.local` 读取，绝不进 manifest）和 Anvil OpenSpec schema。

## 插件索引
<!-- section: plugins -->

`dsh.yaml` 中所有已启用的条目，按来源分组。第三方条目链接到上游；自研条目链接到本仓库内的目录。

### 第三方 package

- [cost-meter](https://github.com/Han-1413141/dsh-cost-meter) — 在 Web 客户端显示每个会话的费用统计。
- [archify-dsh](https://github.com/tt-a1i/archify) — 在对话中生成可交互的架构图、时序图与数据流图。
- [llm-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) — 增加订阅制 provider（Codex、Claude、Grok、Copilot），可在输入框切换。
- [width-tiers](https://github.com/aaronlei/dsh-width-tiers) — 在五档之间切换对话区宽度。
- [better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 把侧边栏变成服务化的多标签工作台。
- [dsh-opencode-session-header](https://github.com/beihzb/dsh-opencode-session-header) — 发送 OpenCode Go 要求的会话头，修复缺少会话 ID 的报错。

### 官方可选

- [experimental-schedule](https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-schedule-bundle) — 官方的定时自动化页面、schedule 工具与时间上下文。

### 第三方资源

- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) — 面向规划式、规范驱动变更的状态机工作流 skill。
- [jev](https://github.com/jkudish/jev-mcp) — 为 agent 提供语义判断工具的 MCP 服务；密钥只放在 `.env.local`。
- [anvil](https://github.com/jikkujoyce/openspec-schemas) — 测试先行变更流程的 OpenSpec schema。

### 改造自第三方的 skill

- [i-have-adhd](skills/i-have-adhd/SKILL.md) — 答案优先、短步骤的输出模式，仅在用户明确要求时使用。
- [frontend-design](skills/frontend-design/SKILL.md) — 避免千篇一律、默认脸界面的前端设计指引。
- [eli5](skills/eli5/SKILL.md) — 按指定受众的理解水平解释任何主题。

### 自研 package

- [worktree-session](packages/worktree-session/README.md) — 会话首条消息时创建隔离的任务分支与 worktree。
- [dsh-openspec](packages/dsh-openspec/README.md) — 把官方 OpenSpec 工作流以 skill 与命令形式暴露的受管适配器。
- [dsh-memex](packages/dsh-memex/README.md) — 原生持久记忆，按工作区隔离作用域，并提供记忆设置页。
- [dsh-pet](packages/dsh-pet/README.md) — 常驻的桌宠 agent，在可信快照上运行管理类 skill。
- [sidebar-session-provider-icon](packages/sidebar-session-provider-icon/README.md) — 在侧边栏每个会话行显示当前所选模型的品牌 logo。
- [session-title-copy](packages/session-title-copy/README.md) — 在标题旁加一个短 session id 徽标，点击复制完整 id。
- [system-clock](packages/system-clock/README.md) — 在设置底部显示 DSH 主机的时钟、时区与 hostname。
- [session-links](packages/session-links/README.md) — 把当前会话的链接与产出文件汇总到侧栏面板。
- [home-network-model-guard](packages/home-network-model-guard/README.md) — 主机出口位于受限地区时，在输入框禁用 Claude 系列模型。
- [subscriptions-sandbox-shim](packages/subscriptions-sandbox-shim/README.md) — 为订阅 provider 剥离 sandbox 升级字段并清理孤立的工具调用。
- [cockpit-worktree-open-shim](packages/cockpit-worktree-open-shim/README.md) — 把驾驶舱的远程编辑器接入 Worktree Session 的打开动作。
- [cockpit-memex-browse-shim](packages/cockpit-memex-browse-shim/README.md) — 把驾驶舱的端口转发接入记忆卡片浏览。

### 自研 skill、preset 与 patch

- [ws](skills/ws/SKILL.md) — 查看、提升并清理 Worktree Session 绑定。
- [jev-workflow-router](skills/jev-workflow-router/SKILL.md) — 仅观察的路由提示：判断工作是否应走正式工作流。
- [memex-recall-report](skills/memex-recall-report/SKILL.md) — 统计记忆召回情况，并列出从未被召回的卡片。
- [add-dsh-plugin](skills/add-dsh-plugin/SKILL.md) — 把远端插件加入 manifest、build，并在重启前询问。
- [remove-dsh-plugin](skills/remove-dsh-plugin/SKILL.md) — 从 manifest 移除插件、build，并在重启前询问。
- [dsh-sandbox-notes](skills/dsh-sandbox-notes/SKILL.md) — 关于 sandbox 权限与「not strictly wider」报错的避坑笔记。
- [dsh-pet-executor](presets/dsh-pet-executor) — 不加载全局 skill provider 的 Pet 执行会话 preset。
- [connection-webserver](patches/connection-webserver.yml) — 恢复 Connection RPC 通道注册的 composition patch。

### 自研（独立仓库）

- [dsh-cockpit-bridge](https://github.com/prgrmrwy/dsh-cockpit) — DSH 与 dsh-cockpit 多机器管理器之间的桥接，从 GitHub release 安装。

## 贡献
<!-- section: contributing -->

欢迎提 issue 与 pull request，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，以及 [SECURITY.md](SECURITY.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。行为变化走 OpenSpec change。修改 `README.md` 时必须在同一次提交里同步修改 `README.zh.md`，反之亦然。

## 许可证
<!-- section: license -->

[MIT](LICENSE)。第三方插件保留各自的许可证，上游链接见[插件索引](#插件索引)。

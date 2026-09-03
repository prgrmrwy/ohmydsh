# 安全策略 / Security Policy

## 支持的版本

ohmydsh 是持续演进的个人定制仓,**只维护 `main` 分支的最新状态**。安全修复只在 `main` 上进行。

| 版本 | 是否支持 |
|---|---|
| `main`(最新) | ✅ |
| 历史 commit / tag | ❌ |

## 报告漏洞

**请不要通过公开 Issue 报告安全漏洞。**

请使用以下任一私下渠道:

1. **GitHub Private Vulnerability Reporting**(推荐):在仓库 [Security 页签](https://github.com/prgrmrwy/ohmydsh/security/advisories/new)提交报告。
2. **邮件**:发送至 `prgrmr@163.com`,标题请以 `[SECURITY]` 开头。

报告时请尽量包含:

- 受影响的组件(如 `scripts/sync.mjs`、`bin/dsh`、某个 `packages/<id>`);
- 复现步骤或 PoC;
- 你评估的影响范围(如任意文件写入、命令执行、凭据泄露);
- 相关环境信息(OS、Node 版本、DSH 版本)。

### 响应时间

这是个人维护的项目,尽力而为、不做 SLA 承诺。通常:

- **7 天内**确认收到报告;
- **30 天内**给出评估结论与修复计划。

修复发布后,如果你愿意,我会在 release note 中致谢。

## 本项目特有的安全考量

在评估风险时,请注意 ohmydsh 的以下已知特性 —— 其中一些是**有意为之的设计权衡**,已在文档中显式声明:

### 1. 插件即第三方代码

`dsh.yaml` 中 `source: remote` 的定制会从 npm registry 安装并在 DSH 进程内运行。仓库约定:**精确版本 pin + 在条目 `note` 中记录来源与审查结论**,不 vendor 源码。

若你发现某个已 pin 的第三方插件版本存在漏洞,这属于有效报告 —— 即使漏洞在上游。

### 2. 回环绑定(无局域网形态)

webserver **只绑定回环地址**(`127.0.0.1`)。本仓库已**移除** `web.lan` / `DSH_LAN` 局域网绑定开关与 SSH 隧道配套(2026-09-03 决策:不再提供跨机器访问形态)。

任何路径能让 webserver 在未显式传入 `--host` 时产生**非回环监听**(绕过上面的移除,或让其重新出现),属于有效报告——那会把完整 agent 能力(bash 执行、文件读写)暴露给同网段任意设备,且 DSH 无 TLS(明文可嗅探)。

### 3. 部署面 fail-closed 约定

sync 对 `$DSH_HOME/AGENTS.md` 等托管文件有 ownership/hash 漂移防护:发现未托管文件或本地改动时**报错并保留**,不静默覆盖或删除。

任何能让 sync、`dsh reset` 或 Worktree Session 清理**静默销毁用户数据**、或越出预期目录写入/删除的路径,都属于高优先级安全问题。

### 4. 凭据处理

`.env.local` 已 gitignored,用于存放本机私有配置。订阅类插件可能读取本机已有的第三方 CLI 凭据。任何导致凭据被写入版本控制、日志(`~/.dsh/dsh-startup.log`)或发送到非预期端点的行为,请报告。

### 5. 自动升级链路

`autoUpdate` 默认开启,会在启动/构建前检测并**阻塞式自动升级** DSH 运行体,改写 `dsh.yaml` 并自动 `git commit`。它只改写名字匹配 `@deepseek-ai/dsh-*` 且 pin 等于旧运行体的条目,且要求工作区干净。

任何能借此链路注入任意版本、任意包名或任意命令的路径,属于高优先级问题。逃生门:`autoUpdate.enabled: false` 或 `DSH_SKIP_UPDATE=1`。

## 使用者须知

本仓库驱动的是一个**具备完整本机能力的 AI agent 运行时**(可执行 shell 命令、读写文件)。使用前请理解:

- 只在你信任的机器上运行;
- 安装任何第三方插件前先审查源码;
- `$DSH_HOME/AGENTS.md` 中的模型指令**不是权限授予,也不是强制安全边界** —— 实际能力始终由 runtime context 与工具执行策略决定。

---

## English

**Do not report security vulnerabilities through public issues.**

Use [GitHub Private Vulnerability Reporting](https://github.com/prgrmrwy/ohmydsh/security/advisories/new) or email `prgrmr@163.com` with a `[SECURITY]` subject prefix. Include the affected component, reproduction steps, impact assessment, and environment details.

Only the latest `main` is supported. Best-effort response: acknowledgement within 7 days, assessment within 30 days.

Note these intentional, documented design tradeoffs before reporting: remote plugins are third-party code pinned by exact version; the webserver binds loopback only (`web.lan` / LAN serving was removed 2026-09-03); sync is fail-closed on managed-file drift; and `autoUpdate` performs blocking self-upgrades scoped to `@deepseek-ai/dsh-*` pins. Bypasses of any of these guarantees are valid reports.

This repository drives an AI agent runtime with full local machine capabilities. Run it only on machines you trust, and review third-party plugin source before installing.

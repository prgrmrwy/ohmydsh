# Tasks: DSH 分域持久记忆层

## 0. 实施前诊断

- [ ] 0.1 确认 `memex` CLI 可安装并记录精确版本（`npm view @touchskyer/memex version`），核对 `search` / `read` / `write` 子命令与 `MEMEX_HOME` 行为在本版本上成立
- [ ] 0.2 确认 DSH 版本与 `ctx.tools.register` / `agent.session.header.cwd` 的可用性（对照当前 pin 的 rc 版本与 `docs/notes/dsh-plugin-integration-pitfalls.md`）
- [ ] 0.3 枚举现有工作域并确定初始 scope 表：`~/corp/*` 各业务 scope、`~/opensource/*` 归 `personal`
- [ ] 0.4 确认各 scope 的 git remote 与同步目标（`personal` → GitHub 私有仓；业务 → 公司内部 GitLab 仓是否已存在）

## 1. 包骨架

- [ ] 1.1 创建 `packages/dsh-memex-scope/`（package.json、tsconfig、src 结构），对齐既有 local package 的构建形态
- [ ] 1.2 创建 `packages/dsh-memex/`（同上）
- [ ] 1.3 确认两包的标准构建产物（`lib/` 等）不进入版本控制
- [ ] 1.4 两包各自的 build / typecheck 命令可独立运行

## 2. dsh-memex-scope：scope 解析服务

- [ ] 2.1 定义 `ScopeResolution`（`scope` / `home` / `kind` / `source`）与 `ctx.memexScope` 服务接口（`resolve(cwd)`、`list()`）
- [ ] 2.2 实现配置加载：优先级 DSH settings > `~/.dsh/memex-scopes.yaml` > 内置默认
- [ ] 2.3 实现「文件不存在 → 降级默认」与「文件存在但损坏 → 拒绝服务」的分支，后者错误信息须指明配置文件路径
- [ ] 2.4 实现路径前缀匹配（最长前缀优先）与 git remote 正则匹配
- [ ] 2.5 实现自动派生（`<工作根>/<x>` → scope `<x>`、库 `~/.memex-<x>`）与 `source: derived` 标记
- [ ] 2.6 实现 fallback（`github.com` remote、无 git 目录、无匹配）归入 `personal`，标记 `source: fallback`
- [ ] 2.7 实现库目录创建（仅目录与 `cards/`，**不执行 `git init`、不配置 remote**）与「已创建新记忆库 / 未配置同步」返回提示
- [ ] 2.8 实现会话内解析缓存（cwd 不变可复用），确认不跨会话复用
- [ ] 2.9 单测：解析优先级、worktree 经 remote 命中主仓、fallback、配置损坏 fail closed、配置缺失降级

## 3. dsh-memex：工具面

- [ ] 3.1 封装 memex CLI 调用（注入 `MEMEX_HOME`、超时、**失败不重试**、错误透传）
- [ ] 3.2 实现 `memory_recall`（可选 `query`，省略时返回索引卡；返回携带 scope 与 source）
- [ ] 3.3 实现 `memory_read`（按 slug 读当前库卡片，正文 `[[链接]]` 原样返回、不展开）
- [ ] 3.4 实现 `memory_search`（关键词路径，**不传 `--semantic`**，`limit` 上限 20）
- [ ] 3.5 实现 `memory_retro` 主卡写入（`mode: create|update`），写入前按 slug 精确 + title 关键词查重并在命中时给出警告（不拦截）
- [ ] 3.6 实现 `alsoPersonal`：先写主卡再处理跨库；`personal` scope 下传入该参数须报明确错误
- [ ] 3.7 确认工具清单只含这 4 个，不注册 `write` / `organize` / `archive` / `links` / `pull` / `push`
- [ ] 3.8 单测：读侧单库隔离（业务会话搜不到 personal 卡）、跨库写入产生两条独立卡、重复 slug 警告、personal 下 `alsoPersonal` 报错

## 4. CrossWriteGuard

- [ ] 4.1 实现 `denyTerms` 从已配置 scope 名自动派生，及 `allowTerms` 显式豁免
- [ ] 4.2 实现内置结构性规则（内网域名与 IP 段、公司 remote 形态、`~/corp/` 绝对路径），确认不可被 `allowTerms` 关闭
- [ ] 4.3 扫描范围覆盖 `alsoPersonal` 的 slug、title 与 body 全文
- [ ] 4.4 实现 fail closed：规则加载失败 / scope 解析失败 / 不确定状态一律拒绝跨库写入
- [ ] 4.5 实现拒绝语义：保留已写入主卡、返回被拒条目与命中规则，使模型可当轮重写重试
- [ ] 4.6 实现审计记录（时间 / scope / slug / 命中规则），确认**不含 title 与 body**
- [ ] 4.7 确认不重复实现上游凭据规则，凭据场景交由 memex `sensitive-input` 处理
- [ ] 4.8 单测：派生词条命中、结构性规则命中、`allowTerms` 豁免生效、规则损坏 fail closed、拒绝后主卡保留、审计无正文

## 5. 文档与说明

- [ ] 5.1 在两包 README 写明守门的**能力边界**：拦可模式化标识与结构，不拦语义层业务信息；定位是「减少误写」而非「保证不泄漏」
- [ ] 5.2 写明跨库卡片必须去业务化重写、以及人对 `personal` 库定期复核的配套保证
- [ ] 5.3 在 `docs/notes/` 记录：MCP 子进程拿不到会话 cwd 这一约束、以及本插件为何必须进程内注册
- [ ] 5.4 记录 `~/.dsh/memex-scopes.yaml` 不被 sync 物化、换机需手工迁移的运维事实

## 6. 部署与物化

- [ ] 6.1 `dsh.yaml` 新增两条 bundle 条目（含 enable 开关、来源、版本、审查记录）
- [ ] 6.2 `dsh build` 物化到 `~/.dsh/profiles/web`
- [ ] 6.3 创建 `~/.dsh/memex-scopes.yaml`（或确认使用内置默认）并写入初始 scope 表
- [ ] 6.4 按需配置 `personal` 库同步（`memex sync --init <GitHub 私有仓>`），确认未配置前不产生任何同步行为
- [ ] 6.5 按需配置业务库同步到公司内部 GitLab
- [ ] 6.6 在 `AGENTS.md` 加入 retro 时机指引（任务完成后主动 retro）
- [ ] 6.7 幂等校验：`node scripts/sync.mjs` 连跑两次报 `no changes`

## 7. 验收

- [ ] 7.1 在 `~/corp/nexus` 会话调用 `memory_search`，确认返回 `scope: nexus` 且结果不含 `personal` 库卡片
- [ ] 7.2 在 `~/opensource/ohmydsh` 会话确认解析为 `scope: personal`
- [ ] 7.3 在业务会话用 `memory_retro` + `alsoPersonal`，确认两库各新增一条内容不同的卡片
- [ ] 7.4 构造含业务标识的 `alsoPersonal`，确认被拒、返回命中规则、且主卡仍在
- [ ] 7.5 构造损坏的 `~/.dsh/memex-scopes.yaml`，确认所有记忆工具调用被拒绝并指明文件路径
- [ ] 7.6 在某业务仓的 git worktree 内调用，确认落到主仓 scope
- [ ] 7.7 确认 `memex serve` 能浏览各库、Obsidian 能打开 `cards/` 并识别 `[[链接]]`（验证无 lock-in）
- [ ] 7.8 重启 DSH 后人工复核以上各条，并回填本 change 的验收证据

## 8. 归档准备

- [ ] 8.1 运行 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`，记录实际输出
- [ ] 8.2 确认 `openspec/changes/dsh-memex-scoped-memory/specs/` 三个能力的 delta 已反映最终实现行为
- [ ] 8.3 回填 BACKLOG 条目（含 B007 `/btw` 未覆盖项——「只记录、不立即处理」的纯记忆形态）

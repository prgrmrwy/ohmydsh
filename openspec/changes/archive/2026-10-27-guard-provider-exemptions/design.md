# Design

## Context

见 proposal.md。Guard 的 Host createEgressGate 和 Web judge 共用 isClaudeFamily；配置由本机 JSON 投影校验，设置页目前只保存两个字段。Magpie 的 info.provider 为 dsh-magpie，displayGroup 仅影响展示，CatalogModel.provider 表示网关上游而非 DSH route。

## Goals / Non-Goals

**Goals:** 两端按实际 provider 精确豁免；支持配置编辑与撤销；Geo 故障不阻塞已确认豁免。

**Non-Goals:** 不推断网关实际出口，不改 UI 分组和模型 ID，不删除旧 provider 的本机数据或迁移旧会话，不改其它发送限制。

## Decisions

1. 新增共享 requiresEgressGuard(provider, model, exemptProviders)。列表严格匹配原始 route ID，不做大小写或前缀匹配；保留 isClaudeFamily。避免把 UI/displayGroup 作为权限事实。
2. 通用 DEFAULT_CONFIG.exemptProviders=[]；单独的仓库配置 patch 向 guard 插件传入默认 [dsh-magpie]。本机 JSON 中显式列表优先，[] 撤销；字段缺失时继承部署默认，非法文件回退无豁免。Host 每次流入口加载有效配置再决定是否调用 Geo。
3. 新增轻量 policy RPC，仅读取配置，不等待 Geo。Web 先刷新策略并重评估，再刷新网络状态；失败撤销客户端豁免。保留既有 check/status 语义。定时刷新和页面可见时刷新策略；保存设置派发本插件配置变更事件，立即强制刷新与重评估。刷新用代际避免旧异步结果覆盖新策略。
4. 设置页增加逗号分隔的 provider 输入，基于 status.config 提交完整配置，保留超时参数；保存成功触发重评估。不新增 provider 目录依赖。
5. 移除 manifest 的 dsh-magpie-connect 条目。已停用的显示名 shim 另有退役范围，保留；历史文档、本机凭据与数据不删除。

## Risks / Trade-offs

- 显式信任整个 provider → 设置说明填写真实 route ID，精确匹配；不根据模型/分组自动扩展。
- 初次策略尚未获取或 RPC 故障 → 客户端先按原有 Claude fail-closed；policy 不等待 Geo，正常启动只等待一次本机 RPC。
- 其他浏览器客户端配置短暂滞后 → 周期性重新读取策略，Host 始终在新请求时检查当前配置，禁止客户端成为授权边界。
- worktree 变更尚未部署 → 仅在任务目录构建和验证；合入与日常构建/重启留给用户批准后的版本收尾，不操作日常 3080。

## Migration Plan

不迁移旧数据。合入后由主 checkout build 两次验证幂等，再由用户重启 Host。回滚移除配置 patch 或在设置页保存空列表恢复原门禁；旧 connect 若需恢复须从 Git 恢复 manifest 条目，凭据保留。

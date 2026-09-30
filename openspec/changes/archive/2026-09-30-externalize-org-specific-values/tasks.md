## 1. dsh-memex

- [x] 1.1 新增 `src/org.ts`：解析 `internalHosts` / `internalDomains`，校验、归一化、报告非法条目
- [x] 1.2 守门改用配置生成的 remote/域名规则；未配置时报告 `structural:internal-host-rule-inactive`
- [x] 1.3 scope 派生改用配置的内部 host；`apply(ctx, config)` 经 runtime 与 tools 传递
- [x] 1.4 测试：org 解析、守门（三种 remote 形态、域名边界、未配置告警）、scope 派生；测试夹具改用中性名
- [x] 1.5 README 记录配置方式

## 2. dsh-session-links

- [x] 2.1 以产品名命名的分类改为 `tracker`（「工作项」）；评审/工作项域名改为 `reviewHosts` / `trackerHosts` 行配置
- [x] 2.2 host 基线附带 `rules`；浏览器端校验后采用并重分类
- [x] 2.3 测试：配置命中、默认不识别、非法条目、基线重分类、host 提取使用规则
- [x] 2.4 README 记录配置方式

## 3. 迁出与 overlay

- [x] 3.1 send-cr skill、manifest 条目、规范迁入私有仓库
- [x] 3.2 私有仓库新增 `patches/org-hosts.yml` 与对应 manifest 条目
- [x] 3.3 私有仓库提交并推送

## 4. 验证

- [x] 4.1 两个包 typecheck + vitest；仓库 `npm test`、`npm run check:artifacts`
- [x] 4.2 合入后在主 checkout 跑 sync 两次，确认 profile patch 含 overlay 覆盖行、第二次无变化
- [x] 4.3 `openspec validate externalize-org-specific-values --strict`

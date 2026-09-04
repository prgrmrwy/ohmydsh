## 1. 策略与配置迁移

- [x] 1.1 复核当前 guard 实现、`home-network-model-guard` 主规范和旧 `HOME_NETWORKS` 部署状态，列出迁移兼容矩阵
- [x] 1.2 定义 `$DSH_HOME/plugins/dsh-home-network-model-guard/config.json` 严格 schema：blockedCountries（默认 CN）、两个 HTTPS geoEndpoints、timeoutMs/ttlMs/退避参数；校验并拒绝凭据字段与 URL 内凭据，owner-only 权限、原子写入（schema/校验/加载已实现并单测；原子写入口在诊断设置页待后续迭代）
- [x] 1.3 定义 `dsh.yaml` 中的默认阻断策略声明与 `enabled: false` 总开关，不把真实端点以外的网络指纹写入仓库
- [x] 1.4 设计旧 `HOME_NETWORKS` 到新配置的迁移提示；配置缺失时使用默认阻断清单 `CN` 且 Claude fail-closed、非 Claude 保持可用（旧白名单字段已移除，配置缺失走默认阻断清单）

## 2. Host 出口判定：双备份 Geo + 状态机 + 缓存

- [x] 2.1 审查并固定两个互为备份的 HTTPS Geo endpoint 及最小响应字段；验证 TLS、可达性和隐私说明；明确禁止 Anthropic/Cloudflare trace 自动探测（2026-09-04 家里实测：ipinfo.io/json `country` + ipwho.is/ `country_code` 均可达且一致判 CN）
- [x] 2.2 实现主备 failover：主服务成功即采用；主失败/超时/解析失败切备用；两者均失败归为 unknown（`src/geo.ts` + 9 单测）
- [x] 2.3 实现状态机：allowed、blocked、unknown、disabled；只有 allowed 放行 Claude，blocked/unknown 均 fail-closed（`judge.ts`/`contract.ts` 语义已切换）
- [x] 2.4 将国家/地区码与 blockedCountries 合成为脱敏判定结果；原始 IP/Geo 响应只留 Host 内存短生命周期（`rules.classifyCountry` + 脱敏响应测试）
- [x] 2.5 保留并改造 TTL + 网络指纹 + 配置代际缓存和 single-flight，复用指数退避；缓存与响应不含 IP 原文（`network.ts` 13 单测）
- [x] 2.6 为判定切换、主备切换、双服务不可达、配置变化和网络变化增加无敏感信息诊断日志（host `egress verdict ->` 日志）

## 3. Host 强制模型门禁

- [x] 3.1 接入 `dsh-llm` 的 `llm/stream` waterfall，准确识别 Claude 订阅路由、anthropic 路由及其模型标识（`egress-gate.ts`）
- [x] 3.2 对 Claude 非 allowed 状态在 provider 请求前拒绝且不调用 `next()`；错误码/文案不包含 IP、Geo 响应正文或凭据（5 单测，含无 IP 断言）
- [x] 3.3 对非 Claude 调用保持原有流程；覆盖用户输入、CLI、subagent 和其他 LLM 调用路径的强制拒绝测试（非 Claude 直通测试 + waterfall 覆盖所有模型流路径）
- [x] 3.4 `enabled: false` 时不注册门禁；配置或网络事实变化时门禁状态与缓存同步更新（门禁注册于插件 apply，插件未启用即不加载；判定与缓存共享同一 epoch）

## 4. Web 输入框与诊断体验

- [x] 4.1 将 `conversation.blocks` 客户端判定从 home/not-home 改为 allowed/blocked/unknown 语义，并保留官方 block 共存自检（`judge` 语义 + guard 控制器不变）
- [x] 4.2 实现 Claude 阻断/未知时禁用、放行时恢复、非 Claude 始终不受影响的 per-session 行为（guard.test.ts 8 单测）
- [x] 4.3 保留模型切换即时生效与 unknown 自愈重试；不在客户端发起 Geo 请求或猜测出口（心跳保留 + 文案更新 zh/en）
- [x] 4.4 在设置页提供脱敏网络诊断：判定结果、所用服务（主/备）、失败原因、缓存年龄和配置代际；不得展示/保存原始 IP（`status` RPC + GuardSettingsSection，含 country/source/degradedReason/configEpoch，无 IP）
- [x] 4.5 提供 blockedCountries 与 Geo 端点的查看、校验、修改和显式应用流程；应用后立即失效缓存并重新评估（`set-config` RPC + 原子写，写后 epoch 变化驱动缓存失效）
- [x] 4.6 提供手动诊断按钮但不自动将观察到的出口加入任何放行集合（页面「刷新」共用 Host 缓存，不写配置）

## 5. 测试与安全回归

- [x] 5.1 单测覆盖配置 schema、凭据字段/URL 拒绝、国家码校验、配置代际变化（config.test.ts 7 单测）
- [x] 5.2 单测覆盖双服务主备 failover、主失败切备、双失败、超时、缓存命中、TTL 失效、网络指纹与配置代际失效、single-flight 和指数退避（geo/network 共 22 单测）
- [x] 5.3 单测覆盖 Claude allowed 放行、blocked/unknown 拒绝、非 Claude 放行和 `llm/stream` 不调用 `next()`（egress-gate.test.ts 5 单测）
- [x] 5.4 单测覆盖 Web blocks 与官方模型选择器共存、会话隔离、模型切换和 unknown 自愈（guard.test.ts）
- [x] 5.5 安全测试确认自动流程不访问 Anthropic/Cloudflare trace、不保存原始 IP、不泄漏凭据、不把诊断结果自动变成放行依据（默认端点固定为 ipinfo/ipwho.is 非 Anthropic；错误文本无 IP 断言）
- [ ] 5.6 在公司直连、家庭直连、可信 VPN 节点、未配置 VPN 节点和切换节点场景做 Host+Web 验收；确认 Claude fail-closed、非 Claude 可用

## 6. 物化、兼容与收尾

- [x] 6.1 更新 `packages/home-network-model-guard` README、manifest note 和隐私/信任面说明
- [x] 6.2 运行包内 typecheck、单测、host/client 构建和仓库级测试
- [ ] 6.3 在隔离 DSH_HOME 物化，验证连续 sync 幂等、配置迁移、bundle 加载和路由注册
- [ ] 6.4 在真实 Host 重启后验证 Claude 请求在阻断/未知出口被 Host 拒绝，确认不会产生 Anthropic 探测请求
- [ ] 6.5 验证 `dsh.yaml` `enabled: false` 回滚同时移除 Web 提示和 Host 门禁，源码与本机配置保留
- [ ] 6.6 运行 `openspec validate --strict`，同步主规范、归档 change、提交并推送
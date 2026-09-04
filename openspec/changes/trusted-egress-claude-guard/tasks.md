## 1.策略与配置迁移

- [ ] 1.1复核当前guard实现、`home-network-model-guard`主规范和旧`HOME_NETWORKS`部署状态，列出迁移兼容矩阵
- [ ] 1.2定义`$DSH_HOME/plugins/dsh-home-network-model-guard/config.json`的严格schema：blockedCountries、trustedProfiles、IP/CIDR、代理/VPN/路由特征、TTL/超时；拒绝凭据字段并采用owner-only权限
- [ ] 1.3定义`dsh.yaml`中的默认策略声明与`enabled:false`总开关，不把真实出口IP、VPN节点或代理端点写入仓库
- [ ] 1.4设计旧`HOME_NETWORKS`到本机trustedProfiles的迁移提示；缺少新配置时Claude默认fail-closed、非Claude保持可用

## 2.Host本地可信出口与Geo判定

- [ ] 2.1实现Host本地网络事实采集：活动接口、默认路由、可读代理/VPN端点与网络指纹；跨平台不可读项安全降级
- [ ] 2.2审查并固定两个互备HTTPSGeoendpoint及最小响应字段；验证TLS、可达性、限流和隐私说明；明确禁止Anthropic/Cloudflaretrace自动探测
- [ ] 2.3实现两个Geo服务并行查询、单请求超时/Abort、一次失败不以另一服务单独结果放行、国家码冲突归为unknown
- [ ] 2.4实现可信状态机：trusted、blocked-region、untrusted、unknown、disabled；只有trusted允许Claude
- [ ] 2.5将本地事实、trustedProfiles、双Geo结果和配置代际合成为脱敏判定结果；原始IP/端点只留Host内存短生命周期
- [ ] 2.6保留并改造TTL+网络指纹+配置代际缓存和single-flight；缓存失效不得触发持久化网络事实
- [ ] 2.7为Host判定、双服务冲突、服务不可达、配置失配和网络切换增加无敏感信息诊断日志

## 3.Host强制模型门禁

- [ ] 3.1接入`dsh-llm`的`llm/stream`waterfall，准确识别Claude订阅路由、anthropic路由及其模型标识
- [ ] 3.2对Claude非trusted状态在provider请求前拒绝且不调用`next()`；错误码/文案不包含IP、VPN端点、Geo响应正文或凭据
- [ ] 3.3对非Claude调用保持原有流程；覆盖用户输入、CLI、subagent和其他LLM调用路径的强制拒绝测试
- [ ] 3.4`enabled:false`时不注册门禁；配置变更或网络事实变化时门禁状态与缓存同步更新

## 4.Web输入框与诊断体验

- [ ] 4.1将`conversation.blocks`客户端判定从home/not-home改为trusted/non-trusted/unknown语义，并保留官方block共存自检
- [ ] 4.2实现Claude未知/不可信时禁用、可信时恢复、非Claude始终不受影响的per-session行为
- [ ] 4.3保留模型切换即时生效与unknown自愈重试；不在客户端发起Geo请求或猜测出口
- [ ] 4.4在设置页提供脱敏网络诊断：可信profile匹配、双Geo一致性、阻断策略、缓存年龄和失败原因；不得展示/保存原始IP
- [ ] 4.5提供本地trustedProfiles的新增、校验、删除和显式应用流程；应用配置后立即失效缓存并重新评估
- [ ] 4.6提供手动诊断按钮但不自动将观察到的出口加入可信配置

## 5.测试与安全回归

- [ ] 5.1单测覆盖配置schema、凭据字段拒绝、IP/CIDR与本地特征匹配、配置代际变化
- [ ] 5.2单测覆盖双Geo成功一致、结果冲突、单服务失败、双服务失败、超时、缓存命中、TTL失效、网络指纹变化和single-flight
- [ ] 5.3单测覆盖Claudetrusted放行、blocked-region/untrusted/unknown拒绝、非Claude放行和`llm/stream`不调用`next()`
- [ ] 5.4单测覆盖Webblocks与官方模型选择器共存、会话隔离、模型切换和unknown自愈
- [ ] 5.5安全测试确认自动流程不访问Anthropic/Cloudflaretrace、不保存原始IP、不泄漏凭据、不把诊断结果自动变成信任配置
- [ ] 5.6在公司直连、家庭直连、可信VPN节点、未配置VPN节点和切换节点场景做Host+Web验收；确认Claudefail-closed、非Claude可用

## 6.物化、兼容与收尾

- [ ] 6.1更新`packages/home-network-model-guard`README、manifestnote和隐私/信任面说明
- [ ] 6.2运行包内typecheck、单测、host/client构建和仓库级测试
- [ ] 6.3在隔离DSH_HOME物化，验证连续sync幂等、配置迁移、bundle加载和路由注册
- [ ] 6.4在真实Host重启后验证Claude请求在未知/不可信出口被Host拒绝，确认不会产生Anthropic探测请求
- [ ] 6.5验证`dsh.yamlenabled:false`回滚同时移除Web提示和Host门禁，源码与本机配置保留
- [ ] 6.6运行`openspecvalidate--strict`，同步主规范、归档change、提交并推送

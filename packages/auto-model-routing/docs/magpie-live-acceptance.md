# Magpie 真实最小验收与本地部署

2026-10-25。用户授权按订阅最小必要调用完成验收与本地部署重启，不授权全局默认切换或发布。

## 实际结果

- 在线 Magpie `/models` 返回 200，确认完整 provider/model 与 effort 元数据；不依赖磁盘缓存作可用证明。
- GPT：真实 Jev + 生产插件 + 官方 ordinary 子工具 + Magpie adapter，最终 `dsh-magpie-connect` / `codex/gpt-6-luna` / medium / maxTokens=1024，4322 ms，排序去重 JSON 确定性 oracle 通过。
- Claude：先遇网关账户认证 502，用户重新登录后成功；同一路径选 `claude/claude-haiku-5-5` / low / maxTokens=1024，4027 ms，同一 oracle 通过。未绕到本地 Claude。
- 实际结果仅证明生成可用与请求配置；不证明底层服务内部推理投入与 effort 参数完全相等，不宣称统计性能收益。订阅实际美元成本 unknown。
- 尝试旧策略表参考时被官方固定工具实例拒绝显式 model 参数，未产生该参考模型执行；已删除不可用试验分支，不冒充完成策略对照。6任务保留集仍未运行。

## 部署与现场

- 首次 `dsh build` 因仓库工作依赖缺少 lottie-web 失败，恢复已声明依赖后第二次构建成功；再跑一次构建成功且没有 changed/reinstall/generate 操作。
- 通过 manifest/sync 物化源码，没有手改部署插件。没有升级 DSH。最终再次逐字节确认部署的 index、policy-host、policy-v2、client 构建与源码构建一致；读取持久配置确认为 legacy/AUTO，没有改变全局策略。
- 自动 restart 尝试中断，用户手动恢复服务成功；现有 3080 GUI 已实测可访问，未将自动重启记为成功。近期日志没有足够证据定位自动重启挂起根因，不猜测。
- 使用官方启动 URL 认证隔离浏览器，不输出 token；现有 GUI 的设置页显示原策略被选中、v2 试验入口存在。切换 v2 草稿后保存按钮启用；切回原策略并关闭，未保存或改变全局策略。
- 190 项 package 测试、typecheck 在依赖恢复后再次通过；mock 官方完整冷恢复证据见开发报告。GUI 只验界面入口与草稿状态，不冒充在真实 GUI 已执行完整子路由。

## 全仓检查

全仓 `npm test`：447 项，444 通过、2 跳过、1 失败。唯一失败为文档治理要求链接目标已进入 Git tracked 集合，而本次新增报告尚未暂存；文件真实存在，不为制造绿灯自动 staging 或改写治理测试。package 190 项测试全部通过；artifact check、严格 OpenSpec、diff check 通过。

## 边界

当前 policy 是插件全局设置，不是单会话策略选择；没有承诺仅启用某一会话就实际保存全局开关。默认仍为旧策略。若要全局启用 v2 需用户明确选择。真实 fresh teammate、fork、任务质量收益和保留集对照均不在此最小验收通过范围。

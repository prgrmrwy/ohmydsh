# 离线生产补线整批代码复核（2026-10-28）

## 范围与结论

本次基线 HEAD `6bea1e2c111b9e9d96f243788ebfb7e9183b0c0c`，审查整个未提交生产补线及新文件，而非只看最后一处修复。已结合当前批准design/spec、正式compat源码、本地diff、真实runtime和工具producer测试核对。

OFFLINE_VERDICT: PASS_WITH_ACCEPTANCE_BOUNDARIES

该结论只允许交用户做部署/Host/live验收，不是整体change PASS或发布许可。verify.md保留完整门槛FAIL，EVAL032仍未验。

## 核实并修复的阻断项

| 项 | 原始根因 | 最终处理及证据 |
| --- | --- | --- |
| 顶层生产入口 | managed runner只有测试调用 | 固定eval/runRound装配可信Host依赖，真实六条件闭环 |
| 正式选模回读 | selectModel不修改创建agent.options | 读durable model/selection，逐请求头仍事后审计 |
| 首次私有目录 | register前父目录不存在 | 显式安全递归建目录，祖先非目录/symlink拒绝 |
| 持久化采集 | lazy writer，idle/stat不保证物理文件存在 | 正式sessions.flush checkpoint后采集，真实ENOENT复现后绿 |
| 准入取消竞态 | signal入口检查后await attachments，cancel早于followup | 请求边界abort gate+admission后二次cancel；真实deferred路径adapter0 |
| 无限普通工具循环 | whenIdle无时长/步骤监测 | 每条件128请求/120秒软观察与取消，根/递归后代覆盖；真实循环2请求界限测试 |
| 默认值无确认出口 | pending阻止所有后续新轮次 | 只读pending/status及明确人工confirm marker，不写模型默认值 |
| all-unknown成功0 | CLI丢弃runRound判据 | Host经checked报告聚合evidenceComplete，CLI未齐非零 |
| 冻结升级漂移 | report强比当前manifest/prose | 执行严格当前发布、报告验证支持的冻结wire/绑定；不重判历史 |
| R数字前缀 | 40/450/小数前缀匹配4/45 | 数值边界回归，链接不展开 |
| 子会话写意图 | 无reminder即默认主动 | 非固定natural实际输入意图unknown，保守不猜，未来不追溯 |
| 安全续跑缺失 | run-started永拒全部 | 显式连续内存owner factory，全旧根/后代/jobs再证，pre-score普通故障新attempt、history保留；无未知提交/评分重试 |
| 跨RPC服务身份 | Cordis traceable proxy每次引用不同 | 官方symbols.original比较底层服务，复用原可信controller/routing/backend；Agent exact身份不弱化 |

## 未采纳的误报与约束

- 不因managed-round没有finally就盲目dispose裁判父：不确定失败现场保留是批准合同，runHostJudge本身finally管理child；正式agents.create也有caller-fiber结构所有权。
- 不将固定natural followUp标成明确写卡要求；未知文本不能靠正则猜意图。
- 不移除unhealthy/request历史来冒称原失败请求已成功；resume结果独立保存，旧记录永久保留。
- 不把归档/idle、kill请求、wait完成、terminal、空列表或removed单独作为jobs释放证明。
- 不复制Host监听/认证，不扫描日志或browser cookie，不自动restore默认模型，不在bridge接受任意fixture/path/schema。

## 整批最终复核

- 正常run、显式resume、standalone judge彼此有claim和固定预算；同request已完成结果幂等；resume重建dispatcher/跨generation/unknown prompt/评分已开始/资源未证都fail closed。
- 保存旧attempt、完成outcome和ledger/registry；历史move校验绝对路径/目录/独占目标，无删除旧cwd或库。report仍读当前canonical attempt，旧资源历史保留。
- Memex真实tool产物形状和parser已覆盖，R/W不从泛用read或失败stdout推断；semantic answer/write quote来源分离，不外发reasoning。
- 配置evalSelftest是额外ordinary config而非覆盖workspaces数组；原scope/binding声明保持，实际route冲突仍拒绝。AUTO Host service与HTTP复用同state/policy/feedback逻辑，240回归通过。
- 发布bin/lockfile/Node chmod/fixtures/managed patch/README双语和skill接线一致；标准输出不含认证token/cookie，原始HTTP/RPC错误不直接回显敏感文本。

## 验证与保留边界

最终Memex 118files/775tests、Host/client typecheck/build通过；AUTO 240 tests/typecheck；仓库640total/638passed/2既有skips及最终治理39tests/artifacts/strict/diff通过。完整命令/范围见verify.md。

尚待授权的Connection实际认证/Origin/authority、完整日常preset与真实模型/资源清退、两次受管build幂等仍不得标通过。新增测试TypeScript未由现有src-only tsconfig静态覆盖。固定mock输出不验证裁判校准或Memex有效性。git diff/hash不是历史发布签名；写入成功位和参数不等于独立磁盘diff核验，报告保持此unknown。

# 结构化证据格式

全部元数据为 UTF-8 JSON/JSONL，仅 Python 3.9+ 标准库。旧 YAML 目录不兼容。拒绝重复 JSON key、NaN、Infinity。

## oracle.json

```json
{"schema":1,"items":[{"id":"AC-1","title":"保存设置","precondition":null,"input":"点击保存","expected":"Toast 提示保存成功，刷新后值保留","provenance":"spec","source":"plan-ac","path":["设置","保存"],"priority":"P1","entry_point":"/settings","reviewer_notes":null,"expected_source":"spec"}]}
```

id 唯一；title/input/expected 非空；provenance=spec|independent；priority=P0|P1|P2；path 为来源树层级而不是证据文件路径。所有来源先写 `{"items":[...]}` 片段，经 `validate_oracle.py --fragment <file>` 校验，再合并。来源冲突必须展示而非覆盖。

用户确认后 `validate_oracle.py --checking-dir <dir> --freeze` 记录整个文件哈希至 plan.meta.oracle_freeze，清空 active_plan_rev。fragment/schema 校验不依赖冻结；freeze 自身允许首次或重新冻结。

## 全计划 revision

确认计划并选择策略后运行 confirm.py。meta.plan_revisions 追加 `{plan_rev,input_sha256,selected,at}`，active_plan_rev 指向新编号，每次确认都严格递增。执行输入涵盖完整 oracle、全部 trails 文件名/对象、完整 plan，但排除四个记账字段：meta.oracle_freeze、meta.plan_revisions、meta.active_plan_rev、meta.external_doc_url。

任何重新确认都会使全部旧观察过期。修改输入但未确认时，状态/追加/执行门禁均拒绝，不沿用旧通过。只改 external_doc_url 不失效。不得为局部 oracle 保留绿灯。

## observations.jsonl

调用者只传事实，其余字段由 observe.py 分配。示例输入（实际为一行 JSON）：

```json
{"checkpoint_id":"T1-S1-C1","loop":1,"batch":"baseline","env":{"app_version":"1.0","remote_version":"1.0","role":"editor","shape":"desktop"},"status":"pass","actual":"Toast 出现，刷新后仍为新值","evidence":[{"path":"evidence/T1-S1-C1/saved.abc123.png","kind":"screenshot","scope":"exact"}],"limits":[],"supersedes":null}
```

命令：`observe.py append --checking-dir <dir> --expected-plan-rev <开始执行时固定的rev> --json '<record>'`。脚本在锁内比较 expected revision；旧 worker 迟到、缺参数或 active 为空均拒绝且不改日志。不能把旧结果重标为新 revision。

落盘还包括 obs_id、at、plan_rev，evidence 每项附完整 sha256。status=pass|fail|manual|skipped|partial|blocked。env 允许自由键；复测时复制旧非版本键，版本变化只使用 app_version/remote_version。

supersedes 只能指向更早、尚未替代、同 checkpoint、同 plan_rev、同非版本 env 字典的观察。修复复测和误判纠偏都追加替代记录，actual 写明理由。既有 JSONL 字节不变。loop 不自动取消旧失败。

## 证据路径与不变性

path 必须相对 checking-dir，以 evidence/ 开头，不含 ..，解析符号链接后仍在根内并为普通文件。pass/fail 至少一条证据；没有证据必须在 limits 写原因。kind=screenshot|dom|network|log，scope=exact|shared-step。

截图先写 scratch，归档到 evidence/<checkpoint>/唯一文件名。摘要前缀可提高可读性，不是唯一性保证；已有目标同内容可共享，不同内容不可覆盖。执行门禁核对完整 sha256，历史证据也需保留。工具退出0不代表证据存在，禁止按文件名猜图。

## 统计

status.py 只看当前 plan_rev、未 supersede 的有效观察。checkpoint 按 fail > blocked > partial > manual > pass > skipped 取最严重；无有效观察为 pending。默认 continue 重跑 pending/blocked，fail 需明确复测并 supersede。门禁通过不等于 PASS。

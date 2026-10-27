# 报告格式

report.md 每轮追加 Loop，不覆盖旧轮。结构门禁不是验收结论，统计只能用 status.py 当前plan_rev计算。输出至少以下章节：

```markdown
# 验收自测报告
## Verdict
FAIL / needs-human / ineligible-degraded / auto-accept-eligible，并给出依据。
## 独立性
高/低/degraded；低必须注明“oracle 与实现同源，绿不等于免人工”。
## 范围声明
本次未覆盖(需其它手段): UT(type=unit) · e2e接口契约 · SAST/安全 · 扫描准确性 · 可维护性 · 性能
## Mock 证据
探测路径、启用/回滚方式、missing/unknown的用户决定。
### Surface × 数据态覆盖
每个surface和empty/few/many/long/error/permission的计划、观察和缺口。
## 执行策略
推荐、风险、用户确认的策略、worker分工及本次plan_rev。
## 期望来源缺口
expected_unverified清单，不把这些通过当原需求符合。
## Loop 1
实际动作、按focus结果、证据引用、受限和阻塞。
### 未覆盖 / 天然盲区
IME、竞态、没跑到或不具自动判定资格的范围。
### 未覆盖的 oracle
没有origin:oracle checkpoint挂载的oracle，不用derived填满覆盖率。
### 派生 checkpoint
derived清单及状态；“派生检查通过不代表原需求通过”。
## 声明 × 证据 × 缺口台账
逐checkpoint列出title/expected、实际、精确证据路径、limits。
```

把 `status.py --checking-dir <dir> --markdown` 输出放入下列标记之间，保留输出原文，不手算通过率：

```text
<!-- case-verify:summary:start -->
<脚本生成内容>
<!-- case-verify:summary:end -->
```

最终回复与任何report-sink推送之前，必须现跑 `validate_execution_gate.py --checking-dir <dir> --require-report`。记录所有FAIL并回退修正。没有证据但有limits的pass不等于完整验收证据，必须在报告中显式提示。历史已过期或被supersede的观察保留，但不得混入当前摘要。

所有真实checking产物本地留存；人工确认脱敏后才可按仓库政策提交报告或摘要。不要公开来源原文、角色名、本机绝对路径或网络响应。

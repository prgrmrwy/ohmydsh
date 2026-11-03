# Verification

## Build and restart

2026-11-02，经用户明确授权，使用公共 npm registry 完成正式 compat launcher 构建。再次不设置 registry 运行 builder 命中 fingerprint，未重复安装。五个已退役展示覆盖包在该 graph 中均解析为官方 `0.2.0-rc.2`；Team 保留 `0.2.0-rc.2-team-membership.1`。

正式 `sync` 再运行为 no changes。随后执行会话内 `dsh restart`，仅以排程回执报告已排程；重连后核对 `dsh history`：restartId `20261102-105309-88127-9a174c` 达到 ready，新 Host 使用 fingerprint `b1daa72527ceefb145b56361cb8f3f227c326c7d672e6aaa81d532f4a677ae39`。2026-11-03 再次核对，最新启动记录仍为该 graph。

未改动正式 provider 凭据或 registry 配置文件。公共 registry 仅通过构建进程环境变量指定。

## Browser acceptance

使用 case-verify，oracle 与四条 trail 已经用户确认，单 agent 执行，固定 plan_rev=1。范围为日常 GUI 的只读选择器检查，不发送模型请求、不更改模型、effort、AUTO 模式或设置。

首轮独立浏览器遇到认证门；使用当前 Host 官方启动 URL 认证后续跑。同 revision 的后续观察通过 supersedes 更正旧结果，不覆盖证据。验收报告与精确统计保留在本地 `checking/report.md` 和 `checking/observations.jsonl`，该目录由仓库忽略，不提交原始浏览器证据。

2026-11-03 复测后的 status.py 当前有效统计为 14 pass、0 fail、0 blocked、0 pending（plan_rev=1）。已有 MANUAL 会话中 trigger/root/effort menu 为相同 Max 单值，菜单仅一个勾选；已有 AUTO 会话中为相同 high 单值。选择器实际出现四个 Magpie 归属组，与普通 provider 并存；九个 Magpie 模型通过 route 与目录 model ID 对照，无重复。完整名、部分名搜索和不再按 Magpie 组标签搜索符合预期。真实 GUI 网络响应包含八个 groups、71 个 models，均不含 displayGroup。

先前“侧栏未找到普通会话”的 blocker 被官方 session/list 与模式查询推翻；仅靠侧栏标题搜索不能证明没有适用会话。旧 blocked 与无效前置下的早期 pass 均保留为历史，经同 revision 的 supersedes 更正，不计入当前结论。

浏览器首次认证打开首页时，GUI 自行发出一次 session/create 请求，HTTP 200；响应正文无法取回，因此不能确认语义创建成功。未向该空白页面发送消息，也未将它用于有效 checkpoint 或做清理。验收不应宣称完全没有写请求。其余被测会话的模型、effort 和模式未因验收切换，未发送被测模型请求。

主会话复核最终 `validate_execution_gate.py --require-report` 为检查通过，仅提示未覆盖 oracle DL-5、DL-9；`git diff --check` 和 OpenSpec 严格校验通过。执行器的独立浏览器均已关闭。

oracle 只有 spec 来源且 lint 低于自动验收阈值，所以最终 verdict 仍须保留 needs-human；14 项通过不等于获得自动验收资格。DL-5、DL-9 的实际选择提交、网关空/非法归属、真实请求中 AUTO effort 同步及其他 locale 不在本次只读验收范围。

## Manual checks

2026-11-03：用户按前述手工步骤检查 DL-5（切换 effort、模型保持、显示与刷新保持）和 DL-9（点击/键盘选择模型、当前显示与刷新保持），回复“没问题”，并进一步确认“验收没问题了，继续”。两项人工交互已获用户确认。证据为用户反馈，未留浏览器录像或提交请求的独立抓包，不将人工确认伪装成自动 checkpoint 的新 pass；原 case-verify 的 14 pass 与 needs-human 资格结论保留。

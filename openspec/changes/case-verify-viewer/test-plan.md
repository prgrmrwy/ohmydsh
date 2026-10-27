## Test Plan

评审门禁：review.md 为 APPROVE_WITH_CHANGES 且 CHANGES_APPLIED: yes。以下均为尚未实现的预期测试，红色不表示已实际运行失败；实施时必须先见到正确原因的失败。

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| specs/case-verify-viewer/spec.md → view 子命令只读且显式选择目录 | 运行前后目录不变 | `skills/case-verify/tests/test_view_server.py` | `test_read_only_snapshot` | 🔴 red |
| specs/case-verify-viewer/spec.md → view 子命令只读且显式选择目录 | 管道 stdout 下立即可读到就绪行 | `skills/case-verify/tests/test_view_server.py` | `test_ready_line_flush` | 🔴 red |
| specs/case-verify-viewer/spec.md → view 子命令只读且显式选择目录 | 端口被占用 | `skills/case-verify/tests/test_view_server.py` | `test_port_in_use` | 🔴 red |
| specs/case-verify-viewer/spec.md → view 子命令只读且显式选择目录 | 候选目录不唯一 | `skills/case-verify/tests/test_view_server.py` | `test_ambiguous_directory` | 🔴 red |
| specs/case-verify-viewer/spec.md → catalog 只由结构化文件构建 | catalog 不泄露实现路径 | `skills/case-verify/tests/test_catalog.py` | `test_catalog_path_projection` | 🔴 red |
| specs/case-verify-viewer/spec.md → catalog 只由结构化文件构建 | 正文中的绝对路径照样保留 | `skills/case-verify/tests/test_catalog.py` | `test_absolute_source_text` | 🔴 red |
| specs/case-verify-viewer/spec.md → catalog 只由结构化文件构建 | 来源文本原样保留 | `skills/case-verify/tests/test_catalog.py` | `test_source_text_literal` | 🔴 red |
| specs/case-verify-viewer/spec.md → catalog 只由结构化文件构建 | 旧格式或无观察 | `skills/case-verify/tests/test_catalog.py` | `test_old_or_missing_observations` | 🔴 red |
| specs/case-verify-viewer/spec.md → catalog 只由结构化文件构建 | 证据缺失或越界 | `skills/case-verify/tests/test_catalog.py` | `test_missing_or_escaping_asset` | 🔴 red |
| specs/case-verify-viewer/spec.md → oracle 汇总采用保守规则且标明为计算值 | 纠偏后通过 | `skills/case-verify/tests/test_catalog.py` | `test_rollup_superseded_fail` | 🔴 red |
| specs/case-verify-viewer/spec.md → oracle 汇总采用保守规则且标明为计算值 | 部分 checkpoint 尚未执行 | `skills/case-verify/tests/test_catalog.py` | `test_rollup_pending_member` | 🔴 red |
| specs/case-verify-viewer/spec.md → oracle 汇总采用保守规则且标明为计算值 | 通过但无证据 | `skills/case-verify/tests/test_catalog.py` | `test_rollup_no_evidence` | 🔴 red |
| specs/case-verify-viewer/spec.md → oracle 汇总采用保守规则且标明为计算值 | 未覆盖与派生不计入 | `skills/case-verify/tests/test_catalog.py` | `test_derived_not_coverage` | 🔴 red |
| specs/case-verify-viewer/spec.md → 两种视角浏览同一份数据 | 同内容重新确认后的历史展示 | `tests/case-verify-viewer.test.mjs` | `test_history_expired_on_reconfirm` | 🔴 red |
| specs/case-verify-viewer/spec.md → 两种视角浏览同一份数据 | 深链定位 | `tests/case-verify-viewer.test.mjs` | `test_deeplink_checkpoint` | 🔴 red |
| specs/case-verify-viewer/spec.md → 两种视角浏览同一份数据 | 文本按字面渲染 | `tests/case-verify-viewer.test.mjs` | `test_render_literal_html` | 🔴 red |
| specs/case-verify-viewer/spec.md → 两种视角浏览同一份数据 | 不存在的深链 | `tests/case-verify-viewer.test.mjs` | `test_unknown_deeplink` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 合法图片 | `skills/case-verify/tests/test_view_server.py` | `test_asset_image` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 前端模块可加载 | `skills/case-verify/tests/test_view_server.py` | `test_logic_module_route` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | skill 目录与 checking 目录分离 | `skills/case-verify/tests/test_view_server.py` | `test_static_root_separation` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 资产启动后被改指到根外 | `skills/case-verify/tests/test_view_server.py` | `test_asset_replaced_symlink` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 越权路径 | `skills/case-verify/tests/test_view_server.py` | `test_forbidden_paths` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 非本机来源 | `skills/case-verify/tests/test_view_server.py` | `test_cross_site_host` | 🔴 red |
| specs/case-verify-viewer/spec.md → 查看器服务只在本机提供 catalog 内的文件 | 网络证据不下发 | `skills/case-verify/tests/test_view_server.py` | `test_network_not_served` | 🔴 red |

## Coverage Notes

- 每个场景唯一映射一个命名测试；覆盖 5 个 requirement、24 个 scenario。
- Python 测试使用前置 change 的临时合成 checking fixture，真实数据与外部原型不参与测试。管道就绪使用 subprocess+selectors，不等待服务 EOF；所有服务在 finally 中 shutdown/terminate 并回收。
- Node 前端测试直接加载生产 app.js 的 mount 和 logic.js，用最小 DOM 替身断言文本及事件；过期场景同时核对 catalog 与两种时间线标记。真实浏览器布局/lightbox 观感另外在验收时记录，不把 DOM 替身等同于浏览器。
- 只读回归在无其他写者下比较目录/符号链接集合、文件 sha256 与 mtime_ns；不声称证明所有瞬间从未写入。
- 额外回归：search/filter、跨视角 oracle 链接、loop/env 分组、lightbox/Escape；参与 checkpoint 全部 pass、同 revision 跨 loop 未解除 fail、重新确认后全部历史过期；HEAD、DOM text/plain+nosniff、所有 403/404 的 CSP/no-store、JPEG 魔数、资产 hash 不符。
- 所有路径/HTTP 安全回归只用临时目录与 loopback，不访问网络。network/log 的不可下载验证同时断言映射表没有 key，以及穷举路由的服务规则。
- 前置实施门槛：先完成 case-verify-skill，再核对 `_model` 的只读结构加载（可关闭资产检查）、status 计算接口及 fixture。接口不符必须先修订并复审，不在 viewer 中复制另一套状态算法。

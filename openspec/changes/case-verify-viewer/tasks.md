## 0. 前置边界

- [ ] 0.1 确认 case-verify-skill 已实施并验证；核对共享只读模型/状态接口和 fixture；不满足则停止。

## 1. 运行前后目录不变

- [ ] 1.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_read_only_snapshot`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 1.2 按 `view 子命令只读且显式选择目录` 实现该场景，使 1.1 转绿；更新 test-plan 对应行。
- [ ] 1.3 重构并运行相关完整测试集，保持绿色。

## 2. 管道 stdout 下立即可读到就绪行

- [ ] 2.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_ready_line_flush`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 2.2 按 `view 子命令只读且显式选择目录` 实现该场景，使 2.1 转绿；更新 test-plan 对应行。
- [ ] 2.3 重构并运行相关完整测试集，保持绿色。

## 3. 端口被占用

- [ ] 3.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_port_in_use`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 3.2 按 `view 子命令只读且显式选择目录` 实现该场景，使 3.1 转绿；更新 test-plan 对应行。
- [ ] 3.3 重构并运行相关完整测试集，保持绿色。

## 4. 候选目录不唯一

- [ ] 4.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_ambiguous_directory`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 4.2 按 `view 子命令只读且显式选择目录` 实现该场景，使 4.1 转绿；更新 test-plan 对应行。
- [ ] 4.3 重构并运行相关完整测试集，保持绿色。

## 5. catalog 不泄露实现路径

- [ ] 5.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_catalog_path_projection`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 5.2 按 `catalog 只由结构化文件构建` 实现该场景，使 5.1 转绿；更新 test-plan 对应行。
- [ ] 5.3 重构并运行相关完整测试集，保持绿色。

## 6. 正文中的绝对路径照样保留

- [ ] 6.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_absolute_source_text`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 6.2 按 `catalog 只由结构化文件构建` 实现该场景，使 6.1 转绿；更新 test-plan 对应行。
- [ ] 6.3 重构并运行相关完整测试集，保持绿色。

## 7. 来源文本原样保留

- [ ] 7.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_source_text_literal`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 7.2 按 `catalog 只由结构化文件构建` 实现该场景，使 7.1 转绿；更新 test-plan 对应行。
- [ ] 7.3 重构并运行相关完整测试集，保持绿色。

## 8. 旧格式或无观察

- [ ] 8.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_old_or_missing_observations`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 8.2 按 `catalog 只由结构化文件构建` 实现该场景，使 8.1 转绿；更新 test-plan 对应行。
- [ ] 8.3 重构并运行相关完整测试集，保持绿色。

## 9. 证据缺失或越界

- [ ] 9.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_missing_or_escaping_asset`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 9.2 按 `catalog 只由结构化文件构建` 实现该场景，使 9.1 转绿；更新 test-plan 对应行。
- [ ] 9.3 重构并运行相关完整测试集，保持绿色。

## 10. 纠偏后通过

- [ ] 10.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_rollup_superseded_fail`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 10.2 按 `oracle 汇总采用保守规则且标明为计算值` 实现该场景，使 10.1 转绿；更新 test-plan 对应行。
- [ ] 10.3 重构并运行相关完整测试集，保持绿色。

## 11. 部分 checkpoint 尚未执行

- [ ] 11.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_rollup_pending_member`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 11.2 按 `oracle 汇总采用保守规则且标明为计算值` 实现该场景，使 11.1 转绿；更新 test-plan 对应行。
- [ ] 11.3 重构并运行相关完整测试集，保持绿色。

## 12. 通过但无证据

- [ ] 12.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_rollup_no_evidence`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 12.2 按 `oracle 汇总采用保守规则且标明为计算值` 实现该场景，使 12.1 转绿；更新 test-plan 对应行。
- [ ] 12.3 重构并运行相关完整测试集，保持绿色。

## 13. 未覆盖与派生不计入

- [ ] 13.1 在 `skills/case-verify/tests/test_catalog.py` 写失败测试 `test_derived_not_coverage`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 13.2 按 `oracle 汇总采用保守规则且标明为计算值` 实现该场景，使 13.1 转绿；更新 test-plan 对应行。
- [ ] 13.3 重构并运行相关完整测试集，保持绿色。

## 14. 同内容重新确认后的历史展示

- [ ] 14.1 在 `tests/case-verify-viewer.test.mjs` 写失败测试 `test_history_expired_on_reconfirm`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 14.2 按 `两种视角浏览同一份数据` 实现该场景，使 14.1 转绿；更新 test-plan 对应行。
- [ ] 14.3 重构并运行相关完整测试集，保持绿色。

## 15. 深链定位

- [ ] 15.1 在 `tests/case-verify-viewer.test.mjs` 写失败测试 `test_deeplink_checkpoint`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 15.2 按 `两种视角浏览同一份数据` 实现该场景，使 15.1 转绿；更新 test-plan 对应行。
- [ ] 15.3 重构并运行相关完整测试集，保持绿色。

## 16. 文本按字面渲染

- [ ] 16.1 在 `tests/case-verify-viewer.test.mjs` 写失败测试 `test_render_literal_html`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 16.2 按 `两种视角浏览同一份数据` 实现该场景，使 16.1 转绿；更新 test-plan 对应行。
- [ ] 16.3 重构并运行相关完整测试集，保持绿色。

## 17. 不存在的深链

- [ ] 17.1 在 `tests/case-verify-viewer.test.mjs` 写失败测试 `test_unknown_deeplink`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 17.2 按 `两种视角浏览同一份数据` 实现该场景，使 17.1 转绿；更新 test-plan 对应行。
- [ ] 17.3 重构并运行相关完整测试集，保持绿色。

## 18. 合法图片

- [ ] 18.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_asset_image`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 18.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 18.1 转绿；更新 test-plan 对应行。
- [ ] 18.3 重构并运行相关完整测试集，保持绿色。

## 19. 前端模块可加载

- [ ] 19.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_logic_module_route`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 19.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 19.1 转绿；更新 test-plan 对应行。
- [ ] 19.3 重构并运行相关完整测试集，保持绿色。

## 20. skill 目录与 checking 目录分离

- [ ] 20.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_static_root_separation`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 20.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 20.1 转绿；更新 test-plan 对应行。
- [ ] 20.3 重构并运行相关完整测试集，保持绿色。

## 21. 资产启动后被改指到根外

- [ ] 21.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_asset_replaced_symlink`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 21.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 21.1 转绿；更新 test-plan 对应行。
- [ ] 21.3 重构并运行相关完整测试集，保持绿色。

## 22. 越权路径

- [ ] 22.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_forbidden_paths`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 22.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 22.1 转绿；更新 test-plan 对应行。
- [ ] 22.3 重构并运行相关完整测试集，保持绿色。

## 23. 非本机来源

- [ ] 23.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_cross_site_host`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 23.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 23.1 转绿；更新 test-plan 对应行。
- [ ] 23.3 重构并运行相关完整测试集，保持绿色。

## 24. 网络证据不下发

- [ ] 24.1 在 `skills/case-verify/tests/test_view_server.py` 写失败测试 `test_network_not_served`，确认因缺少目标行为而失败，不接受导入或语法错误作 red。
- [ ] 24.2 按 `查看器服务只在本机提供 catalog 内的文件` 实现该场景，使 24.1 转绿；更新 test-plan 对应行。
- [ ] 24.3 重构并运行相关完整测试集，保持绿色。

## 25. 接入与验证

- [ ] 25.1 补齐 test-plan Coverage Notes 中的额外回归，先失败测试再最小实现，不把纯函数通过当浏览器验收。
- [ ] 25.2 更新 SKILL.md，view 分支直接使用受管后台任务，保留 job id，等待就绪/health 并提供停止方法；普通入口维持原验收流程。
- [ ] 25.3 运行 Python/Node 测试、npm test、npm run check:artifacts，以及本 change strict 校验，记录命令和真实结果。
- [ ] 25.4 用合成 fixture 在真实浏览器检查双视角、搜索筛选、深链、lightbox/Escape、过期标记及计算值声明，截图留本地不入库。
- [ ] 25.5 生成 verify.md，逐项核对 test-plan 全绿、review 有效、交付状态；未实施前不得填写 PASS。

## 1. 规范与回归基线

- [x] 1.1 记录官方 API 方案、严格边界、独立依赖图与授权范围，完成 proposal/specs/design
- [x] 1.2 将既有裁判测试装配原版 Team 并确认成功场景因缺少隔离而 RED，保留负例和无 Team 成功场景（原版 Team 成功场景失败，无 Team 场景通过；失败是 stopReason:error，非导入错误）

## 2. 实施

- [x] 2.1 在 exact child 边界安装已知 Team 工具展示投影，保持原执行与最终请求门禁，确认目标回归 GREEN（真实 Team 和无 Team 均通过）
- [x] 2.2 移除集成测试 Pet 路径/compat 假设，加入显式外部图解析与输入拒绝测试（四文件 25 项回归通过）
- [x] 2.3 补齐官方开发依赖、UI 测试依赖和根 lockfile，更新独立测试与隔离说明

## 3. 验证与评审

- [x] 3.1 在默认官方图运行全包 test/typecheck/build，核对退出码与 skipped，不只看 JSON success（819 pass / 1 live skip；退出码 0）
- [x] 3.2 独立无 Pet 环境验证最终源码的完整六条件、边界、清退与依赖/产物身份；显式兼容图补充回归（独立全包同样通过，25 项审计回归、2334 次解析无禁止路径）
- [x] 3.3 复核完整 diff、严格规范与产物检查，记录实际结果及未执行的 live/部署范围（见 verify.md、review.md）

## 4. 收尾

- [x] 4.1 同步新增 integration requirements，保留其它 change 状态与原历史数据（两个 requirement 逐字核对，54 项 current specs 通过）
- [x] 4.2 归档完成的本 change 并提交本地变更；不推送、不发布、不重启
- [x] 4.3 从主 checkout 受管构建物化，第二次 no changes；核对部署 JS 与源构建 SHA-256 相同，不宣称当前进程已加载

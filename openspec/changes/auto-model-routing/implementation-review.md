> **2026-10-20：以下为首版（本地规则，`13f1587b`）的实施与验收记录，范围已被修订取代，仅作历史参考。**

# 实施复查记录（进行中）

审查范围：规划提交 `dcfcfdb` 之后的自动路由 package、skill、manifest、根锁及针对性测试。实现尚未提交；不包括独立 configurable-jev-provider 草案。此文件不替代规划审查或最终 verify。

## 已发现并修复

1. 同 turn 的模型变化后错误复用旧映射 effort。回归 `new_model_same_turn_remaps_effort` 先失败（Astra 得到 xhigh），修复为按实际 route/支持集重映射后通过；任务级别不重新分类。
2. 已消费的用户选择不能只靠 pending 恢复。新增仅折叠 `model/selection` 的 Host 投影，历史请求头不更新该投影；`latest_historical_pick_survives_request_headers` 先失败后通过。
3. 浏览器通用 RPC 发送信封，而初始 fetch handler 只接受业务 body。Host 集成测试先出现 invalid request，再加入信封适配并通过。认证仍由官方 connection 提供。
4. 集成假流 finish 帧最初为字符串，不符合官方类型。改为 `{kind: 'stop'}`，官方品牌类型使用构造函数；新增 `tsconfig.test.json`，typecheck 同时覆盖源码与全部测试，避免只有 transpile 没有类型验证。

## 已有证据

- `npm --prefix packages/auto-model-routing test`：37 passed，0 failed，0 skipped（修正 finish 帧后再次执行）。
- `npm --prefix packages/auto-model-routing run typecheck`：源码与测试严格类型均通过。
- `npm --prefix packages/auto-model-routing run build`：Host tsc 与浏览器 bundle 通过。tsdown 仍提示 external 弃用和 CommonJS 建议，当前 CommonJS 模块包装与平台加载器一致。
- 真实 AgentLoop + 官方 installModelSelection + 官方 modelSelection 投影测试通过。临时恢复“一次复原清标记”的错误实现后，两条回归失败：medium/xhigh 而非 medium/medium，以及 header 前失败错误清除义务；已恢复正确实现，测试再绿。
- `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/auto-model-routing-sync.test.mjs`：1 passed；实际编译包及 skill 在临时目录经真实 sync.mjs 物化，第二次 no changes。DSH 安装 CLI 使用仓库测试替身，不声称真实 CLI/GUI 验收。
- `npm run check:artifacts` 通过，但只检查已跟踪路径；新包未跟踪文件仍需交付前核对。
- 初次整仓 `npm test`：426 tests，418 pass、6 fail、2 skip。5 fail 因 dsh-openspec/lib 未构建；补建后单独重跑该文件 6/6 通过。剩余首页索引漏 ponytail/ponytail-skills，未越界修改。
- 根 `npm audit --omit=dev --json`：4 high，均是既有 OpenSpec→fast-glob→micromatch→braces 链，不执行降级/force fix。

## 后续复查修复

- 持久状态 JSON 原先只做类型断言，形状损坏仍被当合法状态读取。`disk_state_rejects_malformed_shape` 先红，使用现有 zod 验证 mode/restore/anchor 后通过；损坏不回退为默认 AUTO 或重写文件。
- Host MANUAL 请求原先仍额外查询模型元数据。`manual_and_restore_do_not_need_model_metadata` 先红后绿；只有真正活动的 AUTO 决定才查询支持 effort，MANUAL 稳态与复原不增加此依赖。
- 当前最终批次为 43 pass、0 fail、0 skip；源码与所有测试严格类型、host/client build 通过。

## 未完成的检查

- 已补无 effort、跨用户回合复原、模型不匹配和真实取消路径回归；当前 package 为 41 pass，源码与全部测试 typecheck 通过。33 行映射均绿。完整历史恢复由官方投影注册回放提供，现有单测直接验证 fold，Host 测试覆盖真实注册；尚未声称磁盘完整会话恢复集成已执行。
- 新 package 文档、依赖与忽略规则的完整交付检查；再次执行根级针对性/全套检查。
- 当前 GUI 现场位置与真实委派须用户授权启用；manifest package 与 skill 均为 enabled:false。
- 未部署、未合入、未归档。所有剩余任务保留未完成，不以本报告宣布整体 PASS。

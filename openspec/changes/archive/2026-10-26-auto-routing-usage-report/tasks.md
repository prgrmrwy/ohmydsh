## 1. 评审与精简（实现前）

- [x] 1.1 第 1 轮：无当前上下文的子会话只读评审，结论 REVISE（3 Critical / 12 Moderate / 3 Suggestion），见 `review.md`
- [x] 1.2 按评审修订；用户决定：前后对照仅作参考，并去掉快照
- [x] 1.3 第 2 轮复审：结论 APPROVE_WITH_CHANGES（0 Critical），已应用 N1–N6
- [x] 1.4 用户要求做过度设计审查：采纳 7 条精简（仅统计 policy-v2，复用 FeedbackBook，简化切帧，只输出 JSON，覆盖仅保留一项回合指标，参照组只看 effort，只保留 `--since`），记录于 `review.md`

## 2. 测试样例（先写）

- [x] 2.1 编写合成 `DSH_HOME` 生成器，覆盖 design D7 列出的全部情形
- [x] 2.2 按 spec 场景逐条编写断言
- [x] 2.3 编写 `node --permission` 只读与访问范围测试（允许读取测试 DSH_HOME、包目录与 zod 目录），以及源码出站静态扫描；编写默认 `DSH_HOME` 回退测试

## 3. 统计入口

- [x] 3.1 在 `src/usage-report.ts` 实现切段解码与事件读取
- [x] 3.2 实现会话筛选、用户回合识别、FeedbackBook 关联、分组与字段统计
- [x] 3.3 实现覆盖计数、`referenceBeforeAuto`、门槛与 `conclusion`/`caveats`，以及反馈汇总
- [x] 3.4 实现 `--since` 与稳定排序的 JSON 输出；所有测试通过
- [x] 3.5 对本机真实数据只读运行一次，记录：读取失败各类计数、未关联绑定数、无记录回合比例，以及同一输入连续运行两次的输出是否字节一致；人工确认没有无法解释的异常。只在 change 中记录聚合结论

## 4. Skill 与分发

- [x] 4.1 编写 `skills/auto-model-routing-report/SKILL.md`：触发限定写入 description 与正文；SOP 包括运行、先检查读取失败与未关联数、解释 `conclusion`/`caveats` 且转述时保留含义、贴到会话外前请用户确认，并说明不能删除旧日志这一前提
- [x] 4.2 在 content 测试中断言 skill 文案含触发限定
- [x] 4.3 运行 `npm pack --dry-run`，确认包含 `lib/usage-report.js` 与 skill；在只安装 npm 包的临时目录中，以测试 `DSH_HOME` 在 `node --permission` 下运行
- [x] 4.4 运行 `dsh build` 部署后，确认 skill catalog 中该 skill 恰好出现一次

## 5. 收尾

- [x] 5.1 更新 README（中英文）与 CHANGELOG；将 `docs/feedback-evaluation.md` 中“不做报表”改为指向该 skill
- [x] 5.2 运行包内 typecheck/test/build 与仓库 `npm test`；运行 `openspec validate --strict`；同步主 spec 后归档

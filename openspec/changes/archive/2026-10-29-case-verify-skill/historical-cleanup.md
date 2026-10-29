# 历史 checking 清理执行范围

## 授权与边界

用户在获知新规则会拦截236个已跟踪文件后，明确选择“本次一并清理旧文件”。执行已批准spec的严格政策，不添加路径或哈希豁免，不修改已批准的行为要求。

当前清单：16个change、236文件；其中14个archive共186文件，2个在途change共50文件。类别包括Markdown168、YAML31、JS脚本17、门禁文本11、JSON7、patch2。清单来自真实check:artifacts输出，不按扩展名自动推定可删。

## 处理原则

1. 逐文件读取，区分计划/执行数据、历史报告、可复用源码和合成fixture。
2. 保留必要的非私有历史结论、失败和未完成边界至各checking根summary.md。摘要不是原详细证据的等价替代，不继承原引用行号或伪造验收通过。
3. 仍被运行代码/测试使用的源码迁到适当source/test helper域并修复调用；不为保留旧日志而移动整个目录绕过规则。
4. 其余违规文件从当前树删除。删除之前验证精确绝对路径、属于清单、是普通受跟踪文件；不递归删目录，不动未跟踪/ignored本地原证据。
5. 修正文档引用：轻量摘要对应摘要，需原细节者明确引用历史Git快照120f9140。Git历史保留原内容；此次不是历史重写或秘密清除操作。
6. archive和active2change分离写域并行，Lead检查引用、diff、制品全套与测试。

## 验证

- 清理前check:artifacts：236违规，exit1（已确认RED）。
- 清理后要求check:artifacts为0；所有存活code import都必须指向存在文件。
- 移动的full-gate-assertions保留原断言和launcher-gate测试。
- 不重新运行旧操作性driver，不访问远程Host/桌面，不改变旧验收的时间或结论。

## 执行结果

- 精确删除236个清单路径（archive186、active50），未删除任何额外文件或目录；删除前逐项验证绝对路径/普通文件/无软链及历史快照。当前index已暂存这些移除，但尚未提交。
- 新增16份轻量summary，保留历史失败、partial/skip、未部署、未授权、未重跑等界限；没有整篇复制原始报告。
- 唯一运行中源码消费者是launcher纯assertion helper，已逐字迁至tests/helpers/full-gate-assertions.mjs，原测试import修复，2项launcher回归通过。
- docs治理9项迁移历史增加retired元数据固定完整commit/blob，测试仍从历史读取原文校验迁移头/H1/脱敏，且确认当前树无副本。先见证缺退休记录RED，补记录后31项治理测试通过。原design处置表保留历史意义并附后续退休说明。
- 旧review Markdown中的仓库根相对路径引用仅修正链接目的，finding/verdict不变。跨目录BACKLOG、源码注释与成本分析历史引用注明Git快照，不假装旧详细记录仍在当前树。
- 实际`npm run check:artifacts`：GREEN，exit0；`git diff --check`、cached diff检查与case-verify strict校验均exit0。
- 独立retirement逻辑复核确认无整类跳过；发现非checking也可加retired的边界，现收紧到archive checking Markdown+迁移动作，并加wrong-path/action/reason/commit/blob五项负例，focused2/2通过。另对6份高风险摘要全文及全部摘要常见隐私形状做有限检查，未发现原始内容搬运；不宣称穷尽隐私审计。
- 全仓npm test复跑：644 tests、625 pass、17 fail、2既有skip，exit1；失败位于routing/sync升级、launcher lifecycle、subprocess权限与dsh-openspec构建，尚未取得全绿。没有用focused通过冒充全仓通过。
- Final focused command：`node --test tests/repo-docs-governance.test.mjs tests/tracked-artifacts.test.mjs tests/launcher-gate.test.mjs tests/launcher-acceptance.test.mjs`，43 tests/pass43/fail0/skip0，exit0。
- 变更仅当前worktree；未改Git历史、未清理主checkout、未部署。

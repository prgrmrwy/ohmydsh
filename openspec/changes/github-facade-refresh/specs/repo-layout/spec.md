## ADDED Requirements

### Requirement: manifest 条目说明以人读摘要为准
`dsh.yaml` 的 `note` 字段只承担人读说明，不被任何程序作为数据消费（启动清单优先读 `brief`）。每个 `enabled: true` 的 `customizations` 条目必须(SHALL)声明非空 `brief`，长度不超过 80 个 Unicode code point。每条 `note` 必须(SHALL)不超过 600 个 Unicode code point，内容限于：上游来源与许可（第三方）或对应 OpenSpec change 名（自研）、信任面要点、升级复核点、回滚或移除路径。当其它 current spec 对某条目的 `note` 规定了必须记录的事实类别（例如 `dsh-openspec-session` 对 `dsh-openspec` 条目的要求）时，`note` 必须(SHALL)同时满足该 spec 与本长度上限。审查过程、逐版本历史与实测记录不得(SHALL NOT)写入 `note` 或条目上方的 YAML 注释，应由 git 历史与 OpenSpec change 承载。

#### Scenario: 启用条目都有简短 brief 与受限 note
- **GIVEN** 已应用本 change 的 `dsh.yaml`
- **WHEN** 测试加载 manifest 并遍历启用的 `customizations`
- **THEN** 每个条目的 `brief` 为非空字符串且不超过 80 code point，每个 `note`（若存在）不超过 600 code point

#### Scenario: note 重新膨胀
- **GIVEN** 某次升级把完整审查过程写回某条目的 `note`，使其超过 600 code point
- **WHEN** 运行仓库测试
- **THEN** 测试失败并点名该条目 id 与实际长度

#### Scenario: 其它 spec 要求的事实类别被精简掉
- **GIVEN** `dsh-openspec` 条目的 `note` 删去了升级复核点
- **WHEN** 运行仓库测试
- **THEN** 测试失败，报告该条目缺少 `dsh-openspec-session` 要求的事实类别（测试以固定关键词集合检查 upstream、license、telemetry、credential、upgrade、removal 六类是否各至少出现一次）

### Requirement: note 精简迁移不改变 manifest 的机器可读结构
对 `dsh.yaml` 进行 note 精简的迁移必须(SHALL)保证：分别解析迁移前（迁移开始时的 git 版本）与迁移后的 manifest，删除每个条目的 `note` 与 `brief` 后两者深度相等。该检查是一次性迁移验收，由可重复执行的命令完成并把结果记入本 change 的 `verify.md`，不作为长期回归测试（后续 pin 与配置更新属于正常演进）。

#### Scenario: 迁移前后结构等价
- **GIVEN** 迁移开始时的提交 `<base>` 与迁移后的工作树
- **WHEN** 执行 `node scripts/maintenance/manifest-structure-diff.mjs <base>`
- **THEN** 命令以退出码 0 结束并输出 `structure unchanged`

#### Scenario: 迁移误改字段
- **GIVEN** 迁移过程中某条目的 `version` 被误改
- **WHEN** 执行同一命令
- **THEN** 命令以非零退出码结束，并输出差异路径（如 `customizations[3].version`）

## MODIFIED Requirements

### Requirement: 长期仓库仅保存必要且可维护的派生资产
仓库必须(SHALL)忽略可重建构建输出、OpenSpec checking 的 raw session/history baseline 与批量截图，以及同一架构图的重复重量级导出。长期保留的 checking 内容必须是轻量报告、trail、gate 或复现脚本；仓库每张架构图必须保留一种可直接展示的轻量格式与其可编辑真相源。若原始验收证据仍需审计，报告必须指向 Git 之外的 artifact 位置或说明其留存方式。仓库根目录不得(SHALL NOT)跟踪调试截图或生成的架构说明文件（包括 `.cdp-scratch-shot.png` 与 `worktree-session-architecture.md`）。

#### Scenario: 完成 OpenSpec 验收
- **WHEN** 验收产生 raw JSON、会话历史和一组截图
- **THEN** Git 仅保留可复核的轻量摘要与复现信息，raw evidence 不进入版本控制

#### Scenario: 更新仓库架构图
- **WHEN** 架构变化需要重新生成图形
- **THEN** 开发者更新可编辑图源和唯一的仓库展示格式，不提交同图的 PNG、SVG 与交互 HTML 多套重复导出

#### Scenario: 每张门面图都有图源
- **GIVEN** README 嵌入了总架构图与生命周期图
- **WHEN** 运行 `npm run check:artifacts`
- **THEN** `docs/assets/ohmydsh-architecture.{json,dual.svg}` 与 `docs/assets/ohmydsh-lifecycle.{json,dual.svg}` 均被跟踪，缺任何一个都报告违规

#### Scenario: 根目录遗留产物被重新提交
- **GIVEN** 某次提交重新加入 `.cdp-scratch-shot.png`
- **WHEN** 运行 `npm run check:artifacts`
- **THEN** 检查失败并点名该文件

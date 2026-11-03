# Verification

2026-11-03；基线 `bd7496f448f2ab6eec7c492a1e7c290e3ce27eaf`。本 change 将前序实验方案落实到正式源码，并重新验证最终快照。

## 实现与回归

- 生产逻辑仅在 judge-boundary 增加已知九项 Team 工具的 scoped 展示投影；执行 guard 和真实 loop request/live owner/route/messages/schema/toolHistory 门禁保留。
- RED：原版 Team 下 EVAL-024 返回 stopReason:error；无 Team 对照通过，证明失败不是导入/装配缺失。
- GREEN：原有 19 项裁判回归启用真实原版 Team，新增无 Team 成功场景；独立 Host 选择 helper 覆盖默认图、显式图和无效输入，共四文件 25 项通过。
- 集成测试移除 Pet 路径与 compat 假设，保留六条件、八回合、十二裁判及清退、取消、预算和恢复全部行为检查。Team 仅作开发依赖。

## 执行结果

| 检查 | 结果 |
|---|---|
| 正式仓库默认官方图全包测试 | 124 文件通过、1 文件跳过；819 项通过、1 live 项跳过；退出码 0 |
| 正式仓库 typecheck / build | 通过 |
| 正式仓库 npm pack --dry-run --ignore-scripts | 通过，产物清单保留在本地 checking/pack.json |
| 显式现有兼容 Host 图 | production-runtime + connection-runtime 两项通过；仅作为附加回归 |
| 独立目录重新 npm 安装并运行最终源码 | 819 pass / 1 live skip；typecheck、build、npm ls --all 通过，命令退出码 0 |
| 独立图禁止 Pet/compat/原仓库模块解析后重跑核心组合 | 25/25 通过；2334 次解析、69 个 DeepSeek 包，禁止路径命中 0 |
| 独立依赖 provenance | 81 个官方 DSH 包均为 0.2.0-rc.2，有公共 registry URL 和 SHA-512；无 file/link 或 compat manifest |
| 快照比对 | 独立环境所有 src/test 文件及 package.json 与正式仓库逐字节一致 |
| 规范与产物 | change strict、全部 54 项 current specs、check:artifacts、diff --check 通过 |

根 lockfile 新增 9 个预期开发依赖条目，未删除既有条目，未改变既有条目的版本。开发 DSH 依赖精确 pin 当前目标，runtime/peer 未加入 Pet 或实验 Team。

轻量本地证据：checking/package-tests.json、checking/independent-summary.json、checking/source-hashes.json。独立环境为系统临时目录 memex-decoupled-final-*，保留依赖锁、完整测试结果、审计 loader 与模块轨迹。原始记录不提交。

## 评审与规范同步

当前执行器复核完整改动，结果见 review.md。新增的两个 integration requirements 已逐字同步到正式规范，保留其它要求；再次评估无额外改动。不修改或归档原 evaluation-harness change，不删除 Pet 自身 Team 修复。

## 边界

本次使用本地 mock 模型和原有窄 MANUAL routing 服务夹具；未运行真实 provider、未声明覆盖 AUTO 算法或任意 Host 插件组合。原 live Connection 测试按既有条件跳过。普通 preset fixture 原有不加载用户 AGENTS/skills 的边界保持。

未部署、未重启日常 Host，未升版发布或推送。日常 Host 当前仍可使用旧构建；这份结果证明本地提交的源码与测试已不再需要 Pet，不把源码完成等同部署完成。仓库全量 npm test 未在本次重跑；此前记录的两个无关失败不冒充修复。

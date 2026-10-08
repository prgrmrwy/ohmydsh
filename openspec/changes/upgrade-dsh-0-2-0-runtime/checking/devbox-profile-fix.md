# devbox profile 组合修复验收

## 范围与身份

- 原候选：`c48b50757af1dad34d10ff49842bcfe7acc23a06`。
- RED 测试提交：`95b9407e0040fe88813e4a7145388ab69f496b6d`。
- 修复最终代码/测试/规范提交：`20a498a16dc97004666e861317e37e53d2e929be`。
- 仅 devbox `n37-044-026` 验收，Node 24.12.0、官方 CLI 0.2.0-rc.2。
- 当前机器仅编辑源码和保存 Git 提交/证据；未安装依赖、未 build/sync、未启动或重启本机 DSH。VM 未连接、未操作。
- Git 操作前在 devbox 执行 `set_sh_devbox_proxy`（可用入口是 `zsh -lic`；bash -lic 未注册该命令）。已提交修复以增量 Git bundle 传输，远端 fetch 精确 commit，未复制未提交工作树，未 push 共享分支。

## 修复

1. `scripts/sync.mjs` 对所有版本校验区段外输入。
2. 仅当无注释语法精确为空 flow sequence 时移除其括号；保留前后/行内/内部注释，包括注释里的方括号与 CRLF；非空运行时条目不改写。
3. 拼接后先使用 loader 的 `!!js` YAML 方言验证完整单一序列，再写 patch 或 `.bak`；非法组合 fail closed，不再以两次 sync 成功冒充可加载。
4. `legacy-settings.mjs` 支持去除空序列后只剩注释的文档，仍能在后续 sync 播种旧 settings。
5. scaffold mock 创建真实 `cordis.patch.yml`，不再只创建 package.json。
6. proposal/design/delta spec 对齐 D3 的增强方案 B；实际 configForms gate 3.8 保持未完成，未用规范对齐代替运行时验收。

## devbox 证据

| 检查 | 结果 |
|---|---|
| RED：ownership + scaffold suite，旧实现 + 新测试 | 39 total / 30 pass / **9 fail** |
| 首轮 GREEN：同 suite + 修复 | **39 pass** |
| 最终完整根测试（增加注释括号、CRLF、延后播种覆盖） | **293 total / 291 pass / 0 fail / 2 skipped** |
| check:artifacts | PASS |
| OpenSpec strict | PASS |
| git diff --check / 工作树 | PASS / clean |
| 上轮非法候选，不手改 patch，直接 sync | **自然恢复，官方 dump-config 成功** |
| 该候选再 sync | **no changes** |
| 官方新 profile（新 DSH_HOME，独立 HOME/XDG data/config）sync ×2 | **成功，第二次 no changes** |
| 新 profile 官方 dump-config | **成功，stderr 空，207 个顶层配置行** |
| 声明式 executor preset | dump 中存在 `preset-dsh-pet-executor` |

日志位于 devbox 的 `~/.cache/dsh-acceptance/upgrade-0.2.0-c48b507/logs/`：`profile-red.log`、`profile-green.log`、`fix-final-root-test.log`、`fix-final-artifacts.log`、`fix-final-openspec.log`、`fix-recovery-sync-1.log`、`fix-final-recovery-sync.log`、`fix-fresh-sync-2.log`、`fix-fresh-config.err`、`fix-final-recovery-config.err`。未提交原始日志或私有配置。

环境校正：新候选初次复用了旧候选 XDG data，其独立账本不认领 anvil 目录，按预期拒绝 unmanaged overwrite。随后把 HOME/XDG data/config 一并独立，重新 sync 成功；未删除或接管旧候选目录。

## 全范围自审

审查范围 `c48b507..20a498a`，Native 执行者完成，未使用子代理。

- 变更只涉及 sync/旧 settings 合成、对应回归与已有 change 文档；没有 manifest pin、依赖、Pet/runtime 协议变更。
- 空数组识别前先完成 YAML 解析；只接受无注释文本为 `[ whitespace ]` 的情形，不误删非空集合或用户值。
- 注释与 `!!js` 不执行，已有 block sequence 逐字节保留；不安全的 flow sequence 组合明确拒绝，不静默丢弃条目。
- 写前校验在 no-changes 判定与 `.bak` 写入之前，新增回归证明非法生成片段不会污染原文件/备份。
- 支持 0.1 与 0.2 两族、重复 sync、settings seed，以及修复前失败产物自然恢复。
- 无剩余 Critical/Important 修复发现。该结论仅针对本次修复范围。

## 放行边界

**F1 配置组合阻断已修复，F2 文档漂移已对齐；不等于整个 0.2.0 升级可上线。**

任务 6a.1–6a.3 完成。3.8 实际设置页、6.1 所有 loader/功能、Pet launcher/live probes、Session v4/回滚、私有 overlay 与生产切换等原有门禁保持未完成。

本轮没有启动任何新验收 Host，也没有执行生产 build/restart。devbox 3080 保持原 PID `2004366`；39520 无 listener。修复分支未合入升级分支/主干，未推送，未清理受管 worktree。

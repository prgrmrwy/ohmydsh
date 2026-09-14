## 1. 独立 child 创建

- [ ] 1.1 把 `DEFAULT_CHILD_PROVIDER` 改为零父上下文的 provider，三条创建路径共用同一常量；调用方显式传入的 provider 语义不变
- [ ] 1.2 创建前核验 provider 的 `inheritsParentContext === false`，无法证明时返回稳定失败码并拒绝创建，不静默退回 fork
- [ ] 1.3 测试：默认创建/idle 创建/重建都使用独立 provider；能力不可证明时三条路径均 fail closed；显式传 provider 仍可覆盖

## 2. 上下文模式持久化

- [ ] 2.1 locus 记录新增可选上下文模式字段（`fork-prefix-v1` / `independent-v1` / `unknown`），按 additive 规则演进 schema，不转换或清除既有行
- [ ] 2.2 新建与显式重建写入 `independent-v1`；既有行保持未知，不按创建时间或 provider 默认值推断
- [ ] 2.3 测试：新建写入独立模式、既有行保持未知、旧 fork child 记录与历史不变、离线迁移路径不删除行

## 3. 回复出口与问父路径回归

- [ ] 3.1 回归 `pet_locus_reply` 为业务正文唯一出口，turn 结束未发送时仍如实诊断为未回复
- [ ] 3.2 回归首轮前言仍包含「按需问 caller-bound 主会话」「parent 回复不构成持久授权」「不自动回传结论」三条边界
- [ ] 3.3 测试：独立 child 首轮不含父 transcript 哨兵、lineage 正确、silent settlement 行为不变

## 4. 本地验证

- [ ] 4.1 运行 `npm run typecheck --workspace=dsh-pet`、`npm run test --workspace=dsh-pet`、`npm run build --workspace=dsh-pet`
- [ ] 4.2 运行仓库 `npm test`、`npm run check:artifacts`、`git diff --check`
- [ ] 4.3 `openspec validate pet-locus-independent-child --strict`

## 5. 部署与真实验收（需所有者授权）

- [ ] 5.1 确认目标 home 与兼容 runtime，执行 `dsh build` 物化，验证第二次 sync 无变化
- [ ] 5.2 重启 DSH（由所有者确认时机）
- [ ] 5.3 真实答疑群验收：提问后 child 使用独立上下文，且实际收到飞书回复
- [ ] 5.4 验收 child 在锚点不足时经原生 `send_message` 问父，而不是猜测或自行创建工作目录
- [ ] 5.5 验收主会话未被自动灌入 child 结论
- [ ] 5.6 验收旧 fork child 仍正常服务，历史未被裁剪

## 6. 收尾

- [ ] 6.1 回填真实证据到 `docs/notes/pet-locus-independent-child-handoff.md`，只记录实际执行过的命令与结果
- [ ] 6.2 更新 BACKLOG B035 状态，说明本 change 承接范围与 B035 剩余范围的边界
- [ ] 6.3 与 `pet-unified-locus-collaboration`、`pet-locus-independent-agent-inquiries` 对齐归档顺序；两个 change 修改同一条 requirement，按实际实现顺序重新对齐后再归档

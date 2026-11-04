## 1. 退役兼容运行体

- [x] 1.1 RED：manifest/overlay 声明 `hostRuntimeCompatibility` 时加载阶段报退役错误；原 Pet 声明移除后 `dsh-server-bin` 解析官方运行体
- [x] 1.2 删除 `packages/dsh-pet/compat/`、`scripts/lib/dsh-host-runtime.mjs` 及 sync/launcher/dsh-server-bin/test driver 中的兼容分支与仅服务于它的测试；更新混合测试
- [x] 1.3 删除 `dsh.yaml` dsh-pet 的声明与相关注释，同步 note、README 与 architecture 文档
- [x] 1.4 `npm test`、`npm run check:artifacts`、dsh-pet typecheck/全量、`git diff --check`、`openspec validate --strict`（仓库 735 项：暂存后文档治理 33/33，其余与 dsh-pet 3017 通过/4 跳过、官方无 Pet 专项 16/16 均通过；新增退役测试实现前 5/6 失败、实现后 6/6）

## 2. 部署

- [ ] 2.1 所有者确认后与 locus-three-tier-structure 一并受控合入，主 checkout 两次 build（第二次 no changes）
- [ ] 2.2 受控握手重启，确认启动事件为官方运行体、Pet 停机协议仍可鉴权确认

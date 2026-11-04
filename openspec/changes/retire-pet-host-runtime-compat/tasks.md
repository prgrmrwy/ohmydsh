## 1. 退役兼容运行体

- [x] 1.1 RED：manifest/overlay 声明 `hostRuntimeCompatibility` 时加载阶段报退役错误；原 Pet 声明移除后 `dsh-server-bin` 解析官方运行体
- [x] 1.2 删除 `packages/dsh-pet/compat/`、`scripts/lib/dsh-host-runtime.mjs` 及 sync/launcher/dsh-server-bin/test driver 中的兼容分支与仅服务于它的测试；更新混合测试
- [x] 1.3 删除 `dsh.yaml` dsh-pet 的声明与相关注释，同步 note、README 与 architecture 文档
- [x] 1.4 `npm test`、`npm run check:artifacts`、dsh-pet typecheck/全量、`git diff --check`、`openspec validate --strict`（仓库 735 项：暂存后文档治理 33/33，其余与 dsh-pet 3017 通过/4 跳过、官方无 Pet 专项 16/16 均通过；新增退役测试实现前 5/6 失败、实现后 6/6）

## 2. 部署

- [x] 2.1 所有者确认后与 locus-three-tier-structure 一并受控合入（main 00d0df89），主 checkout 两次 build（第二次 no changes），profile 无 worktree 路径
- [x] 2.2 受控握手重启 20261104-144816-74450-19aa56（preparing-pet→stopping→ready 14:48:26Z，无 legacy 参数）；新 Host PID 74859 由 npx-cache 官方 @deepseek-ai/dsh 0.2.0-rc.2 启动，verifyStopProtocol 鉴权确认 descriptor 与 active status
- [x] 2.3 本机残留清理：确认未被 git 跟踪、无进程占用后删除 main checkout `packages/dsh-pet/compat/`（5.3G，含旧 .launcher/.upstream 等生成物）、worktree 的 `packages/dsh-pet/compat/`（2.1G）与 `.compat-isolated/`（4.1G）。`.gitignore` 的退役规则保留，防其它机器的残留进入 git status。官方无 Pet 专项需另行指定 `DSH_TEST_OFFICIAL_RUNTIME`

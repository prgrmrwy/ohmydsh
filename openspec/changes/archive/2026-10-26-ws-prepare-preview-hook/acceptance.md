# ws prepare-preview：构建后 CLI 验收

日期：2026-10-26。平台：macOS（darwin）。范围：通用 ws 机制，不含 ohmydsh 接入、预览模型、端口退避或 GUI 注册。

## 结论

本轮构建后 CLI 黑盒检查 6 组全部通过。不是生产 GUI 或跨平台验收通过的声明。

执行命令：

```sh
npm run build:host --workspace=dsh-worktree-session
node openspec/changes/archive/2026-10-26-ws-prepare-preview-hook/acceptance-cli.mjs
```

脚本以临时 Git fixture 仓库作为目标，使用已构建的 `lib/cli.js` 子进程发起 prepare-preview、status、promote、clean；fixture 建立通过构建后的 operation API，因为 ws 的首次发送启动本来没有 CLI 命令。断言依据是本 change 的已批准 delta spec，不是从实现生成期望。未读取真实凭据，未启动服务或监听端口。fixture 最终删除。

## 声明与执行证据

| 验收项 | 实际检查 | 结果 |
| --- | --- | --- |
| 完全可选 | 无 hook 仓库 prepare 返回 skipped，status 仍 prepared | PASS |
| 按需与上下文 | start 不执行 hook；手工删除 home 后，通过 CLI 重建为 0700；hook 输出上下文指向正确隔离 home、worktree 和阶段 | PASS |
| 失败与重试 | hook exit 9 时 CLI exit 1、status 可查 failed；改正脚本后重跑为 ok | PASS |
| 并发 | 阻塞 A 的 hook，A 第二次调用拒绝；B 的 start、promote、clean 均完成；释放 A 后正常完成 | PASS |
| 清理顺序与失败语义 | dry-run 不执行 teardown；实际 teardown 在 home 存在时执行并 exit 7；CLI 返回清理成功且带告警，worktree 和 home 已删除 | PASS |
| 危险路径 | 将 fixture operation 的 home 改为源仓库，clean 报告 skipped，源仓库仍存在 | PASS |

运行输出为 6 行 PASS 和 JSON `{verdict: 'PASS', checks: 6, platform: 'darwin'}`。完整临时输出留在工作区 gitignored 的 `.ws-preview-cli-acceptance.log`，不提交 raw evidence。

## 独立性与边界

- oracle 为本项目同源 OpenSpec，执行为构建后 CLI 子进程，因此有入口/打包覆盖，但不是第三方独立 QA。
- 本轮未重复等待 prepare 的 5 分钟默认超时或 teardown 的 30 秒默认超时；超时路径已由前一轮可缩短时间的集成测试覆盖，不冒充本轮 CLI 超时证据。
- Windows 按用户决定暂不作为本轮验收门槛；不承诺支持。
- GUI 工具 schema 仍是旧 Host 加载的版本。需要以后获准部署并重启后做工具注册、绑定解析的 GUI 冒烟。
- ohmydsh 具体模型/凭据迁移与端口退避尚未实施，不在通过范围内。
- teardown 失败继续清理是用户选择；本轮验证了告警，不代表能保证所有预览进程均停止。

## 后续

本轮不授权合入、生产部署、Host 重启或本任务 worktree 清理。后续这些操作仍需用户另行批准。

# settlementNotice 运行时覆盖：已验证可行

原阻塞（pinned 运行时不支持抑制 continuable 子会话自动父通知）已在隔离
环境中解除，不再需要放宽产品边界。

## 方案

- 保留官方 `@deepseek-ai/dsh@0.1.2-rc.1`；
- 从固定 tag 应用 `packages/dsh-pet/compat/subagent/settlement-notice.patch`；
- 在隔离 root package 中用 npm `overrides` 仅替换传递依赖
  `@deepseek-ai/dsh-subagent`；
- 通过仓库已有 `DSH_BIN` 逃生门启动该 root。

这不是 Pet `compatDependencies`：后者属于 profile 依赖根，不能替换 DSH 主包
内部依赖。也不是修改 npm cache 或 vendor 构建产物：补丁与脚本是跟踪真相，
`.upstream/`、`lib/`、`.launcher/` 均可删除重建。

## 实测证据

- 上游补丁行为测试：31 文件 / 778 项通过；
- `npm ls @deepseek-ai/dsh-subagent`：主包所有消费者统一解析到补丁包，无双副本；
- `require.resolve()`：命中本仓库补丁产物，版本与 SHA 来源标记正确；
- 实际 `SubagentRuntime` 实例发布 `supportsSettlementNotice === true`；
- Pet 只有看到该字面量 marker 才放行；官方旧运行时仍 fail closed；
- DSH launcher `--version` 为 0.1.2-rc.1；
- `scripts/dsh-server-bin.mjs` 经 `DSH_BIN` 返回隔离 launcher；
- 对现有 web profile 执行 `--dump-config` 成功；未启动替代 server。

## 可逆性

Worktree Session 的 gitignored `.env.local` 当前配置了 `DSH_BIN`。删除该行
即可回到 `dshVersion` 指定的官方包。上游正式发布后，应移除 override、
补丁目录与该环境变量。

## 尚待

现有 GUI 进程仍是改动前启动的运行时；按仓库规则，部署验证需要构建 Pet、
物化配置，并在用户同意后重启既有 DSH Web，再在实际 Host 上验证
`supportsSettlementNotice` 与 silent child 行为。源码与隔离 launcher 已解除
实现阻塞，后续功能实现可以继续。

# `settlementNotice` 固定源码补丁

## 这是什么

`settlement-notice.patch` 为 DSH 的 continuable 子会话增加可选开关，使指定
子会话的**自动结算结论不写入父会话**。Pet locus 子会话在自己的飞书入口
回答，其结论不应自动灌进主会话。

补丁只改 3 个源文件；默认值 `notify` 与改动前逐字节一致，并保留读取旧版
descriptor，使既有子会话仍可恢复。上游侧验证：`packages/subagent` 31 文件 /
778 测试通过，oxlint 0 问题。

`build.mjs` 物化补丁包，自带四道防护：补丁哈希校验、补丁可应用性检查、
构建后实际调用产物自证能力，以及供 Pet 结构化探测的字面量 marker。任一不
满足即拒绝产出。

## 为什么 Pet compatDependencies 不能直接替换它

`@deepseek-ai/dsh-subagent` 是 `@deepseek-ai/dsh` 主包的传递依赖；普通
profile 插件装在另一个依赖根。把兼容包挂在 Pet 的 `compatDependencies`
会把包装进 profile，却不会替换主包依赖树里的那一份。

这不等于必须 fork 整个 DSH。此前“需要自建全部 223 个运行时包”的判断
**不准确，已由隔离实测纠正**。

## 已实测可行：根 launcher override + DSH_BIN

在一个隔离 root package 中：

1. 固定依赖官方 `@deepseek-ai/dsh@0.1.2-rc.1`；
2. 用 npm `overrides` 将传递依赖 `@deepseek-ai/dsh-subagent` 指向本目录的
   补丁产物；
3. 通过仓库已有的显式逃生门 `DSH_BIN=<launcher>/node_modules/.bin/dsh`
   启动。

执行 `node build-launcher.cjs` 可完整重建。生成的 `.launcher/`、上游检出、
`lib/` 与生成 manifest 均 gitignored；被跟踪的只有补丁、构建脚本与模板。

实测结果：

- `npm ls @deepseek-ai/dsh-subagent` 显示主包、base、fork、driver、SDK、
  web-app 与全部工具**共用一个**补丁版本，无双副本；
- `require.resolve()` 解析到本目录，版本与补丁 SHA 来源标记正确；
- 实际 `SubagentRuntime` 实例发布 `supportsSettlementNotice === true`，Pet
  只在看到该 marker 时放行；
- 实际加载代码包含 `settlementNotice === "silent"` 早退；
- `silent` descriptor 持久记录该字段，`notify` 保持旧默认形态；
- `DSH_BIN` 经 `scripts/dsh-server-bin.mjs` 返回隔离 launcher 的 bin；
- 补丁 launcher 能对现有 web profile 成功执行 `--dump-config`，证明完整
  DSH 主包可以组合现有插件层；未启动替代服务器、未改 npm 缓存；
- npm 默认跳过的 5 个安装脚本（subprocess helper、PTY/native 等）由构建脚本
  按锁定版本显式批准并执行，随后 `npm install-scripts ls` 确认为空，避免
  出现“能 dump config、实际运行时缺 native helper”的假成功；
- 连续重建得到相同的 `package-lock.json` SHA-256：
  `a16d2b7f773b80579274281f9e04707774dc60fd4203d35db5f3c7d437c377b2`。

因此可部署方案不是“fork 223 个包”，而是**保留官方主包，只在独立依赖根
覆盖一个传递依赖**。

## 当前状态与回退

本 Worktree Session 的 gitignored `.env.local` 已指向生成 launcher。删除
该 `DSH_BIN` 行即可回到 `dshVersion` 指定的官方包。现有 Web 进程尚未重启，
所以当前页面仍运行旧 runtime；按项目约定，实际切换须在用户同意后重启。

上游正式发布后，应删除 override、该环境变量和本目录，恢复官方依赖。

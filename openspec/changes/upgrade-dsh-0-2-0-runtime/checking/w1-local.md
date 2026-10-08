# W1 本地实现证据（0.1.5，隔离 DSH_HOME）

全部在 worktree `ws/upgrade-dsh-0-2-0-runtime` 与 overlay worktree `inner-ohmydsh-wt-upgrade-020` 中完成；
未执行 `dsh build`，未触碰 `~/.dsh`，本机 3080 Host 未重启。真实部署验收（1.6 的 build×2、1.7 的重启与 GUI）留待 devbox。

## 0.2 基线（改动前，0.1.5，DSH_HOME=/tmp/...）

| 项 | 结果 |
|---|---|
| 根 `npm test` | 255 tests / 253 pass / 0 fail / 2 skipped |
| `check:artifacts` | 通过 |
| cockpit-memex-browse-shim / cockpit-worktree-open-shim | build/typecheck ok；9 / 4 tests pass |
| home-network-model-guard | build/typecheck ok；70 pass |
| session-links | build/typecheck ok；58 pass |
| session-title-copy | build/typecheck ok；20 pass |
| sidebar-session-provider-icon | build/typecheck ok；25 pass |
| subscriptions-sandbox-shim | 无 build/typecheck 脚本；26 pass |
| system-clock | build/typecheck ok；21 pass |
| worktree-session | build/typecheck ok；212 pass |
| dsh-memex | build/typecheck ok；341 pass |
| dsh-pet | build/typecheck ok；2809 pass / 43 skipped |
| ai-code-report-bridge（overlay） | 26 pass |

## 1.1 traex 禁用
overlay `dsh.yaml` 条目 `enabled: false`，note 记录理由与回滚。

## 1.2 第三方 pin
- cost-meter 1.7.30 → **1.8.11**（任务原写 1.8.6；实施时 latest 为 1.8.11，peer 同为 `旧范围 || >=0.2.0-rc.1 <0.3.0-0`，双侧满足）。
  新增 `lib/cli-bridge.js`（execFile、shell:false、固定参数、15s 超时）只读调用用户自装 qwen-cli/bailian-cli；
  新出现的 5 个域名均为价目 `sourceUrl`/文档常量；ledger 仍为 version 1。
- subscriptions 0.9.6 → 0.9.7：出站域名集合不变，child_process 文件数不变；release notes 声明适配 0.2.0 并保留旧历史翻译。
- width-tiers 1.0.5 → 1.0.6：仅 client.js/README，无 fetch/child_process/新域名。

## 1.3 / 1.4 `agent/session-start` → `agent/created`
上游证据（tag 源码）：0.1.5 `agent/created` 由 `AgentRegistry.announce` 在 `publish()` 内、`agent/session-start` 之前同步 emit，
新建与冷恢复都走 `publish()`；0.2.0 删除 `agent/session-start`，`agent/created` 改为 serial 且带 `source`。
两个版本都只以 `startup`/`resume` 发布 Agent，压缩后不会重新 announce。

- worktree-session：新增 `test/publication-recovery.test.ts`，用真实 AgentLoop + 真实 bind 的 git fixture
  断言绑定上下文出现在首次模型请求中。三方对照：新 hook 通过、原 hook 通过、去掉 hook 失败（证明用例确实覆盖该 hook）。
  全量 214 pass，typecheck ok。
- dsh-memex：新增「0.1.5 无 source 视为新启动」「不再订阅 agent/session-start」两条用例；
  对原代码红（7 fail），改后全绿；全量 343 pass，build/typecheck ok。

## 1.5 ai-code-report-bridge 字段修正
用本机最近 40 个真实 v3 会话（多帧 zstd 解码）核实：`request/header` 只有 `header.config.model`，
`assistant/message` 只有 `message.source.model`；上游 0.1.5/0.2.0 已登记事件类型只有 `tool/ptc-dispatch`。
vendor 0.4.19 仍读 `header.model` / `message.model` / `tool/code-dispatch`。投影改为读宿主形态、输出 vendor 形态。
新增 `test/project.test.ts` 7 例：对旧逻辑 5 例红，修复后全量 33 pass。

## 观察项
W1 改动后第一次根测试出现 1 例 `launcher-npm-env`「server 环境剥离了 npm exec 烘焙的整批变量」失败
（残留 `npm_node_execpath,npm_package_name`）。该文件单独连跑 3 次、整套连跑 2 次全部通过，改动未触及启动器，
判定为偶发；留待 devbox 观察是否复现。

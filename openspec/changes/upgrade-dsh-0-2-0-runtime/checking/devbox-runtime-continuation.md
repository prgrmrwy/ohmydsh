# devbox 完整运行体续验（2026-10-05）

## 结论

**NO-GO，不能合入上线。** Profile YAML 阻断已修复，但真实完整 Host/client 组合又暴露两项发布阻断：Host 全局 fetch 递归、cockpit client 激活失败。未静默禁用插件，未修改生成包来伪造验收通过。

## 身份与隔离

- 被测源提交：`bab1a53607ed13cb764631e794937f054a3b9431`；代码与上轮 `20a498a` 相同，差异仅验收文档。
- devbox：`n37-044-026`。所有构建、包下载、探针、Host 与 Chromium 均在 devbox。
- 独立 `DSH_HOME=fresh-fixed-home`、`HOME=fresh-fixed-user`、独立 XDG data/config；生产数据未导入这个 fresh 候选。
- 仅临时 `127.0.0.1:39521`，Host PID `2158129`。验证后检查 `/proc/<pid>/environ` 中 DSH_HOME 与 cmdline 的 launcher/端口身份，再发送 SIGTERM；退出码 0，端口已关闭。
- 生产 3080 始终 PID `2004366`，未 build/restart；本机和 VM 未作为验收机器。
- devbox 网络前启用 `zsh -lic 'set_sh_devbox_proxy; …'`，没有对真实模型/飞书发消息。

## 已通过

### Pet launcher / 5.3

- 使用隔离 Node 24.12.0；npm 安装的 Node 不附开发头文件，首次 native build 明确报缺失。下载同版本官方 headers，核对官方 SHASUMS256 后只装入隔离 toolchain，再构建成功。
- patched upstream `continuation.spec.ts`：**160/160 PASS**（含默认 8 槽位/释放/冷恢复等源码级测试，不冒充完整 Pet live 探针）。
- 构建产物 `@deepseek-ai/dsh-subagent@0.2.0-rc.2-locus-settlement-notice.2`。
- launcher 实体：`9a913cffbe33ec507ee1a9d3b16c6545a7f5dead5d20abae0adea127bacd01ed-4ed810d6-496e-4ae8-8275-71a9c042d554`。
- 上游 commit `639ed015397290b3745d163aafe02ffee4aa3f84`；patch SHA256 `86310610709d80d540dd97b1b7fb1fbc4012a3ef1f5eadc12ba590f7905005fa`，与源码身份一致。
- 5 marker 与 `deliverSubagentPrompt` 全命中。独立 launcher 报 `0.2.0-rc.2`，`npm ls --all --json` exit 0、无 problems；Cordis 4.0.4，实体路径检查只有 **1 份**。
- 第二次 builder 通过 cached launcher 校验。
- `undici@7.30.0` dispatcher + Node built-in fetch，经 devbox 代理请求公开 npm 固定版本元数据：HTTP **200**、**11 headers**、JSON version `0.2.0-rc.2`。这是独立 launcher 的 transport 证明，不抵消完整插件组合的 F3。
- Corepack 在验收仓根自动添加了唯一 `packageManager` 字段；检查 diff 后撤销该工具生成变更，源码 checkout 恢复 clean。后续运行应设 `COREPACK_ENABLE_AUTO_PIN=0`。

### 部分 Host 门禁

- Pet Host 进入 ready、管理 routes 注册成功，未出现 unified locus seam unavailable；inquiry `marker-absent` 是已知 deferred 能力，不能标为 inquiry 验收通过。
- 官方 cookie 认证后，clock RPC、guard RPC、memex stores RPC 均 **200 / result.ok=true**；Pet status **200 / ok=true**。guard 内容为 unknown/fetch-failed，不能把 transport 200 当成网络功能通过。
- memex 内核回报精确 **0.4.1**。
- 官方 `settings/describe` 找到 live `dsh-memex` form；经 `settings/update` 保存隔离测试 scope `acceptance-scope`，无需重启，memex stores 立即读到该 scope。
- 写入非法名称 `INVALID_NAME` 被拒，前一合法 scope 仍在。
- 停止候选后 sync ×2，第二次 **no changes**；官方 dump-config 无 stderr，仍含 `acceptance-scope`。
- **不勾选 3.8/4.5**：以上仅 Host API 路径，设置页被 client boot failure 挡住，且未加载私有 org overlay，不能声称 UI 操作/逐工作区/org 键全通过。

## F3：全局 fetch 管线递归（发布阻断）

Host 日志重复 `RangeError: Maximum call stack size exceeded`，栈落在 `dsh-opencode-session-header/lib/index.js:171`。cost-meter OpenRouter 价格刷新失败，网络 guard degraded。

根因是两份实际发布包的组合，而非代理/Node dispatcher：

1. `dsh-opencode-session-header@0.1.0` 为 `globalThis.fetch` 安装 accessor；其 compose 的 terminal 每次调用动态 `state.getUnderlyingFetch()`。
2. 后加载的 `dsh-cost-meter@1.8.11/lib/native-search-fetch.js` 在 `observeSearchFetch()` 捕获当前 fetch（即 header compose），然后赋值 `target.fetch = wrapped`。
3. header setter 把 underlying 改成这个 wrapped；wrapped 又调用先前捕获的 compose，形成环。**不命中 opencode 域名也递归**，disabled header 注入开关不消除 accessor 环。
4. 用 devbox 已部署两包、全局 fetch 替换为无网络 Response stub，在两个全新 Node 进程对照：header→cost 顺序 RangeError / 底层调用 0 次；cost→header 顺序成功 / 底层调用 1 次。

registry 查询：header 只有 `0.1.0`，cost-meter 最新仍 `1.8.11`。没有可直接换 pin 的已发布修复。单纯顺序约束只覆盖冷启动，必须继续验证 HMR/卸载重挂；不把反向加载的诊断对照直接当完整修复。应修复发布源的管线互操作，或经明确批准采用受审、可移除的部署层修复。未 vendor 发布包。

## F4：cockpit bridge 令整个 Web boot 失败（发布阻断）

- 页面实际文本：`Failed to load plugins / dsh-cockpit-bridge / web boot: 1 entry did not activate`，不是成功工作台。
- 浏览器没有未捕获 `pageerror`，但 console 有 boot error 和 `cannot get required service "sessions" in inactive context`；**pageerror 空不能用作 loader 全通过的判据**。
- bridge 0.5.1 仍读取已删除的 `sessions.list.getSnapshot().current`，在 effect 中订阅 `uiSession.pendingInteractions`；目标 0.2.0 已改为统一 Session status。前者会静默丢选择，后者与激活失败一致，需要在 bridge 源仓修复并回归。
- npm 404 是因为该包本来就以 GitHub release 分发，不是无可用版本。通过代理查 tags 并下载 0.6.0，固定 tag commit `976f854fb21748e9e535abfd6cc0d5ec06cd19ce`；其发布 client 仍调用旧 `pendingInteractions`，不能靠升级直接解决。
- 此外 0.6.0 删除 `cockpitBridge.portForward`、改为 `cockpitBridge.forwards`，要求 cockpit 服务端和本仓 memex shim 同步迁移；因此未经跨仓范围确认不能机械更新到 0.6.0。

## 未完成门禁

- 5.1/5.6：源码级 160 测试和能力 marker，不替代实际 Host 场景；两组 opt-in helper probe 仍锁定 0.1.2 历史 launcher，不可误报为 0.2.0 的绿灯。
- 3.9：只证明 fragment 存在时 RPC 200，未完成去掉后的 405 反证。
- private overlay exact SHA、org 键、Session v4/回滚、真实飞书、UI/session selection、生产备份与切换仍未完成。

## 证据位置

仅轻量结论入库；owner-only 原始日志留 devbox `~/.cache/dsh-acceptance/upgrade-0.2.0-c48b507/logs/`：
`launcher-build.log`、`launcher-reuse.log`、`launcher-audit.json`、`launcher-npm-ls.json`、`candidate-host.log`、`candidate-browser-result.json`、`candidate-settings-api.json`、`fetch-cycle-header-first.json`、`fetch-cycle-cost-first.json`、`live-settings-sync-{1,2}.log`、`live-settings-dump.yml`。

浏览器认证 state 与启动认证 URL 不进入报告、Git 或交付包。

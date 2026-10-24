# 当前主干 0.2 迁移：devbox clean regression

## 源码身份

- 权威 base：本机 main `b6e5c47415c847387f8c93dbf07fbdafeb253fb2`（2026-10-05）。devbox 生产 main `59ad0e5b` 是 9 月 25 日旧快照，不是更晚的主干。
- migration：旧升级分支净 diff `c9e927e5..131d626`，只提取 manifest/package/lock、packages、presets、scripts、tests；三方 apply 到权威 base 无冲突，78 文件。
- 当前托管任务目录已经应用同一 runtime patch，保留较新主干 Pet shell-tier/security、workspace/org、桥接 0.5.2 等能力。未提交、未合入、未 push/publish。
- devbox clean candidate：`~/.cache/dsh-acceptance/upgrade-0.2.0-c48b507/current-main-build-9fdFNcBd/repo`，HEAD 精确 b6e5c474 + migration patch。Node24.12.0。独立 HOME/DSH_HOME/XDG 与 node_modules，无生产构建/重启。

## 实际执行

| 检查 | 结果 |
|---|---|
| clean npm ci --ignore-scripts --no-audit --no-fund | PASS（298 packages；不代表安装脚本已经执行） |
| 全 workspace build | PASS |
| npm ls --all --json | PASS |
| check-tracked-artifacts | PASS |
| root tests | 291 PASS / 2 skip / 0 fail |
| session-links | 59 PASS |
| session-title-copy | 23 PASS |
| provider icon | 28 PASS |
| home-network guard | 73 PASS |
| system-clock | 21 PASS |
| memex browse shim | 11 PASS |
| worktree open shim | 4 PASS |
| dsh-memex | 350 PASS / 28 files |
| dsh-pet | 2863 PASS / 43 skip，161 files PASS / 3 skip |
| worktree-session | 218 PASS / 32 files |
| subscriptions-sandbox-shim | 28 PASS / 1 skip |
| host/client noEmit | 首轮相同源码复用0.2依赖全部 PASS |
| fresh candidate sync ×2 | PASS，第二次 no changes |
| official dump-config | PASS；loader方言解析207顶层行 |
| OpenSpec strict、git diff --check | PASS |

## 已定位并消除的测试环境失败

- 首輪复用依赖的未构建源码 Pet 1 fail：`lib/client.js` 缺失。全 workspace build 后 clean tree 全量重跑通过；未弱化测试。
- Worktree 首轮2 fail：fixture `packageManager: pnpm@10.23.0`，PATH 中另一 pnpm 自切换指向不存在的 cli。测试专用工具入口用 corepack 精确 pnpm@10.23.0，全量重跑218通过；未改产品逻辑。
- 官方 dump 已成功，但辅助计数脚本默认 js-yaml 不支持 `!!js`。改为 loader 同款 scalar tag（只读取不执行表达式）复跑通过207行；非产品 dump 失败。
- launcher clean 构建首次失败于 tsx native-build IPC socket：验收目录 TMPDIR 过长。单独短路径 owner-only `/tmp/dsh020-*` 重跑后 **完整 builder PASS**，产生 `0.2.0-rc.2-locus-settlement-notice.2` 并通过 builder 的测试/依赖完整性检查；不冒充 Pet live/cold E2E。

## 完整 Host 启动发现（仍 NO-GO）

精确 launcher 在39521真实启动，未认证请求401；Pet routes ready，进程随后由探针SIGTERM正常退出code0。这只证明 bounded Host 启动，不是Web UI/认证加载完成。

启动触发 `dsh-opencode-session-header/lib/index.js:171` fetch栈溢出，cost-meter OpenRouter价格刷新因此失败。说明当前较新主干正式组合依然有历史已知fetch-wrapper环，旧候选采用未发布修复的测试不能替代正式pin。必须在发布源修复/验证后再决定正式pin，不能手改生产生成文件或伪称完整loader通过。

此外审查确认并修复：sync patch未持有ConfigEditor同款package.json锁、退出mergeConfig键残留，以及!!js表达式改写成对象字符串。整个snapshot/合成/原子发布共用官方锁；保守记录逐键原值，禁用/删除时restore/delete，不删除后改用户值；旧settings重叠键可恢复。patch/backup/state/journal显式0600；失败片段不发布部分配置，未知账本fail closed；跨文件进程中断由事务hash恢复，未知后改hash拒绝覆盖。rename无fsync，不宣称断电持久性。

最终同一devbox候选应用这些修复后：**321 tests / 319 PASS / 2 skip / 0 fail**，artifact与diff检查PASS。新增ownership/transaction本机25/25通过，devbox全部根测试已包含这些项。repair五文件SHA256与本机逐一一致。最终独立`final-home`首次sync因Node fetch未消费代理环境失败；设置Node24 `NODE_USE_ENV_PROXY=1`后自然恢复，sync×2第二次no changes、官方dump207 PASS；未删目录、未跳过integrity gate。

## 当前主干真实浏览器补验（2026-10-07）

正式bridge0.5.2在0.2 client订阅已移除pendingInteractions，真实浏览器boot失败，Host200不能捕获此阻断。本机基于精确0.5.2 tag移植适配，保留0.5.2转发分型，devbox34测试/typecheck/build通过。验收专用header/bridge组合下，真实Memory页保存→Host回读→sync×2第二次no changes→official dump→刷新通过，pageerror为空、原scopes恢复、探针Host正常退出。源码补丁已交付，正式pin未改变；详情见[current-main-bridge-memory-ui.md](current-main-bridge-memory-ui.md)。不代表私有org/workspace矩阵或完整Cockpit/Pet端到端通过。

## 不替代的门禁

包级绿色、sync幂等与dump不是全loader执行/设置GUI/真实Cockpit回调/Feishu或Pet E2E。仍需 exact launcher构建、激活池live/cold、preset实际工具挂载、精确child Session、Session迁移/Host回滚、私有overlay逐工作区矩阵与完整GUI验收。生产暂不放行。

生产devbox PID2004366/3080持续原进程，main工作树干净；未修改本机DSH/VM。session-links只做窄兼容，不恢复已撤回Config编辑面。

原始日志留在验收目录和本机`.validation/`，不提交原始session或私有配置。

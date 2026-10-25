# W2 本地实现证据（0.1.5，隔离 DSH_HOME）

## 改动
- `scripts/sync.mjs`：profile `cordis.patch.yml` 只改写 `# >>> ohmydsh generated region >>>` 与
  `# <<< ohmydsh generated region <<<` 之间的内容，区段外逐字节保留；旧版整文件生成物在首次运行时整体当作区段接管（不重复）；
  区段未闭合则 fail closed，拒绝改写。
- manifest 新字段 `mergeConfig: true`（仅 `type: patch`，片段必须是只含 id/name/对象 config 的纯覆盖行）：
  渲染时把区段外同一行已有的 config 键垫在片段下方。解析区段外内容使用与 `cordis-plugin-include` 相同的
  `entryListSchema`（`!!js` 以 `{__jsExpr}` 往返，不求值）；无法解析时 fail closed，不当作空。
- bundle 漂移：`shippedBundles` 只在首次学习；之后出现的、manifest 未声明的 bundle 打印 `[sync] WARN`，保留、不记为出厂。
- `scripts/lib/profile-lock.mjs`：与 DSH `@deepseek-ai/dsh-atomic-write` `withFileLock` 同协议的 `<file>.lock`
  （`wx` + `<pid>\n`，仅在 PID 已退出时经 takeover claim 接管）。sync 三处写 profile `package.json` 改为锁内读改写；
  锁不跨 `dsh plugin` 子进程持有（该 CLI 自己会拿同一把锁）。
- overlay `org-hosts` 条目加 `mergeConfig: true`，片段注释同步新语义。

## 测试（`tests/sync-patch-ownership.test.mjs`，12 例）
对改动前 sync：区段/保留/接管/合并/!!js/解析失败/漂移等 9 例失败，仅「无 mergeConfig 的整行语义」等 3 例本就成立。改后 12/12。
根 `npm test`：267 tests / 265 pass / 0 fail / 2 skipped（基线 255/253）。7 个测试夹具的 lib 复制清单补 `profile-lock.mjs`。

## 2.5 等价性（真实 manifest + overlay，隔离 DSH_HOME，只跑 patch 层）
- 用 main 的旧 sync + overlay main，与 worktree 新 sync + overlay worktree 分别渲染；以本机 `cordis-plugin-include`
  的 `applyEntryPatches`/`entryListSchema` 组合到同一基底：**组合后的 loader 条目逐项相同**（输出 `EQUIVALENT`）。
- 把生产 `~/.dsh/profiles/web/cordis.patch.yml` 的**只读副本**交给新 sync 连跑两次：第一次接管为区段（区段标记 2 个、
  生成头 1 个、org-hosts/connection 片段各 1 个，无重复），第二次 `patches up-to-date`。生产文件哈希与既有 `.bak`（9-29）均未变。

## 已知边界（交给 3.8）
0.2.0 config-editor 保存时整份替换**最后一条**同 id 覆盖行的 config；只要生成区段与运行时行同在 profile patch，
运行时之后的保存仍会让 org 键失效直到下次 sync。见 design D3「W2 实施发现」。

## 留给 devbox / 人工（2.6）
设置页修改 → 连跑两次 `dsh build` → 修改仍在；重启后各插件 config 生效。

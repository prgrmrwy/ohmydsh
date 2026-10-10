# packages/ — 自研 bundle 插件

[English](README.md) · 简体中文

<!-- problem -->
这个目录放本仓库自己开发的插件，每个都是可独立移除的单元。想知道一个 package 必须包含什么、怎样构建和安装、README 怎样分级，就读这里；要挑选某个插件，请从[根 README](../README.zh.md) 的插件索引开始。

每个子目录 = 一个自研定制单元，遵循社区 `dsh.bundle` 标准：

```
packages/<name>/
  package.json        # 声明 dsh.bundle { patch: "./cordis.patch.yml" };独立 semver;ohmydsh.docTier
  cordis.patch.yml    # 本插件的 composition 行(bundle 的一部分)
  src/                # host / client 代码
  README.md           # 英文 README;README.zh.md 是它的简体中文对照
  CHANGELOG.md        # 独立变更记录
```

- 依赖安装统一在仓库根执行 `npm install` / `npm ci`；根 `package-lock.json` 是唯一 lock，不要在 package 子目录生成或提交 lockfile；
- TypeScript package 的 `src/` 是代码真相源，`lib/` 由根 workspace build 或 sync 自动生成并保持 gitignored；不要提交 JS、declaration 或 source map 构建产物；
- 安装：manifest 里声明（`type: package, source: local, version: x.y.z`），sync 先按需构建，再用 `dsh plugin add file:<path>` 安装并自动进 profile bundles；
- sync 会按源码/配置输入哈希重建，并按可发布内容哈希决定是否重装；构建失败发生在移除旧部署之前；
- **发布语义变化时仍须 bump `package.json` 与 manifest 的 version**；同版本源码迭代也会由内容哈希可靠重装；
- 发布：git tag `<id>@<version>`；需要共享时可 publish 到 registry（另行决定）。

## README 分级

每个 package 在 `package.json` 中以 `"ohmydsh": { "docTier": "A" | "B" | "C" }` 声明文档级别；缺失或取值非法时测试失败。每个 package 都提供 `README.md`（英文）与 `README.zh.md`（简体中文），两者在开头几行互相链接。

| 级别 | Packages | 首屏（首个 `## ` 标题之前） |
|---|---|---|
| A | `dsh-pet`、`dsh-memex`、`worktree-session`、`dsh-openspec` | `<!-- problem -->` 段落、位于该 package `docs/` 下的位图截图（可再加示意图） |
| B | `sidebar-session-provider-icon`、`session-title-copy`、`system-clock`、`session-links`、`home-network-model-guard` | `<!-- problem -->` 段落与位于该 package `docs/` 下的位图截图 |
| C | `subscriptions-sandbox-shim`、`cockpit-worktree-open-shim`、`cockpit-memex-browse-shim` | `<!-- problem -->` 段落，以及以 `<!-- section: removal -->` 为锚点的「移除」章节，说明它连接哪两端、何时可以移除 |

截图必须来自填充合成数据的隔离 `DSH_HOME`，不得来自日常使用的实例；每张图都要在图片同目录的 `SCREENSHOTS.md` 中登记（单张 ≤ 400 KiB）。

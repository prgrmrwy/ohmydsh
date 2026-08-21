# packages/ — 自研 bundle 插件

每个子目录 = 一个自研定制单元,遵循社区 `dsh.bundle` 标准:

```
packages/<name>/
  package.json        # 声明 dsh.bundle { patch: "./cordis.patch.yml" };独立 semver
  cordis.patch.yml    # 本插件的 composition 行(bundle 的一部分)
  src/                # host / client 代码
  CHANGELOG.md        # 独立变更记录
```

- 依赖安装统一在仓库根执行 `npm install` / `npm ci`;根 `package-lock.json` 是唯一 lock,不要在 package 子目录生成或提交 lockfile;
- TypeScript package 的 `src/` 是代码真相源,`lib/` 由根 workspace build 或 sync 自动生成并保持 gitignored;不要提交 JS、declaration 或 source map 构建产物;
- 安装:manifest 里声明(`type: package, source: local, version: x.y.z`),sync 先按需构建,再用 `dsh plugin add file:<path>` 安装并自动进 profile bundles;
- sync 会按源码/配置输入哈希重建,并按可发布内容哈希决定是否重装;构建失败发生在移除旧部署之前;
- **发布语义变化时仍须 bump `package.json` 与 manifest 的 version**;同版本源码迭代也会由内容哈希可靠重装;
- 发布:git tag `<id>@<version>`;需要共享时可 publish 到 registry(另行决定)。

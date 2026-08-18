# packages/ — 自研 bundle 插件

每个子目录 = 一个自研定制单元,遵循社区 `dsh.bundle` 标准:

```
packages/<name>/
  package.json        # 声明 dsh.bundle { patch: "./cordis.patch.yml" };独立 semver
  cordis.patch.yml    # 本插件的 composition 行(bundle 的一部分)
  src/                # host / client 代码
  CHANGELOG.md        # 独立变更记录
```

- 安装:manifest 里声明(`type: package, source: local, version: x.y.z`),sync 用 `dsh plugin add file:<path>` 安装并自动进 profile bundles;
- **改代码后必须 bump `package.json` 与 manifest 的 version**,sync 才会重装;
- 发布:git tag `<id>@<version>`;需要共享时可 publish 到 registry(另行决定)。

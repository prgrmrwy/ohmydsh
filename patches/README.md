# patches/ — 纯 composition 片段与覆盖

文件名 `<id>.yml`,内容为 loader patch 行(patch-list YAML,`!!js` 允许)。

两种用途:

1. **纯调优片段**:无代码、只改 composition(如启用某工具行、调整配置);
2. **对 remote 包的覆盖**:个人配置覆盖片段,按 id 与 remote 定制对应(如 `cost-meter.yml` 覆盖 cost-meter 的配置行)。

sync 按 manifest 顺序把 enabled 的 patch 片段合并进 profile 的 `cordis.patch.yml`(带 generated 标记头,覆盖 `~/.dsh` 手改)。

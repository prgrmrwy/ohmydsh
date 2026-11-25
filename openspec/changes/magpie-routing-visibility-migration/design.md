## Decisions

### D1 迁移放在目录同步之后，而不是加载设置时
旧规则下路由入口是否可见取决于它的厂商键「是否保存过选择」：厂商未保存选择即可见。只看设置文件无法知道哪些路由入口属于跟随网关的厂商，仅把厂商白名单里的 id 搬进 `routing` 会把这些入口误隐藏。因此在同步得到目录后计算：`CatalogModel.legacyVisibility` 记录 0.7 之前的可见性键，`routing` = 旧键未保存或旧键含该 id 的路由入口。

### D2 一次性与触发条件
仅当没有 `routing` 键且至少一个路由入口 id 仍在其旧键列表中时触发；迁移后旧键不再含这些 id，`routing` 键存在，不会再次触发。不加版本字段。写盘走既有 `writeSettings`，失败静默，下次同步重试。迁移只依赖目录，不依赖 `routing` 是否被准入：名额已满时路由入口暂列在厂商 route 上，可见性同样按 `routing` 键判断。

### D3 不处理的情况
旧键里隐藏（未列出）的路由入口，若旧键中没有任何路由入口 id 则不会触发迁移，会回到跟随网关；这是 0.7 已记录的 BREAKING，README 说明。会话选择属于宿主，插件不迁移。

### D4 紧凑行
多账号单窗口行：`.dmg-sidebar-account-line` 只放账号；`.dmg-sidebar-row-line.is-account` 放 plan、窗口名与 `.dmg-sidebar-reading-group`（到期+读数，`margin-left:auto`），`flex-wrap:wrap` 使放不下时整体换行。用户已在隔离预览中确认。

# zydsh — DSH 定制仓

本仓库是 DSH(DeepSeek Harness)的定制仓:**总配置统一管理,各项定制可插拔、独立版本、独立维护,但都在同一仓库内**。

## 真相源约定

- **仓库是唯一真相源**。`dsh.yaml` + 各定制目录 = 完整配置;`~/.dsh` 是物化产物。
- `~/.dsh` 下手改**不保留**:`cordis.patch.yml` 由 sync 生成(带 generated 标记头),presets/skills 由 sync 复制。要改配置,回本仓库改,再 sync。
- **禁用 ≠ 删除**:`enabled: false` 只表示不物化,仓库内容保留,随时可重新启用。

## 目录结构

```
dsh.yaml                  # 总配置(唯一开关面)
BACKLOG.md                # 想法池
openspec/                 # spec-driven 变更流程
scripts/dsh.fish          # 锁版本启动 + dsh-sync
scripts/sync.mjs          # manifest → ~/.dsh 物化
packages/<name>/          # 自研 bundle 插件(见 packages/README.md)
presets/<id>/             # agent preset(见 presets/README.md)
patches/<id>.yml          # 纯 composition 片段 / 对 remote 包的覆盖(见 patches/README.md)
skills/<name>/            # skill(见 skills/README.md)
```

## 使用

```bash
node scripts/sync.mjs     # 物化(幂等,可重跑)
# fish: dsh-sync
```

sync 行为按定制类型:

| 类型 | source | 物化动作 |
|---|---|---|
| package | local | `dsh plugin add file:<packages/<id>>`(自动进 profile bundles) |
| package | remote | `dsh plugin add <spec>`(自动进 profile bundles) |
| preset | — | copy 到 `~/.dsh/.agent-presets/<id>` |
| patch | — | 按 manifest 顺序合并生成 profile `cordis.patch.yml` |
| skill | — | copy 到 `~/.dsh/skills/<id>` |

## 第三方定制(remote)约定

- 只存三样:**精确版本 pin**、**个人覆盖片段**(`patches/<id>.yml`)、**条目说明**(`note`/审查记录);**不 vendor 源码**。
- 升级 = 改 pin 重跑 sync;不自动漂移。
- **安全提醒**:插件即第三方代码(社区列表明示警告),安装前先看源码,`note` 记录来源与审查结论。

## 开发流

- 新想法 → `BACKLOG.md`;单项实施 → openspec change(`openspec new change <name>`);
- 自研 package 改代码后**要 bump 版本**(manifest 同步),sync 才会重装;
- DSH 升级后重跑 sync 恢复全部定制。

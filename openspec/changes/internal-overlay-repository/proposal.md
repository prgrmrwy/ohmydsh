## Why

现有 manifest overlay 只能在公开仓库之外承载**定制条目**，承载不了**定制源码**：
overlay 里 `source: local` 的 package / skill / preset / patch 仍然到公开仓库的
`packages/`、`skills/`、`presets/`、`patches/` 下找源码。结果是，不可公开的自研能力
要么把源码放进公开仓库（被 gitignore 也会被根 npm workspaces 收进公开 lockfile），
要么先发布成远端包再引用，每次迭代都绕一圈发布。

已有多个不可公开的自研定制在排队（内网采集桥接、内网任务派发等），它们需要的是
「一个与 ohmydsh 目录同构的私有仓库，构建时先合并再物化，入口仍是 ohmydsh」。

## What Changes

- **overlay 所在目录即 overlay 根。** 由 overlay 文件追加的条目，其 local 源码
  （`packages/<id>/`、`skills/<id>/`、`presets/<id>/`、`patches/<id>.yml`）与
  `buildInputs` 从 overlay 文件所在目录解析，不再固定为公开仓库根。overlay 位于
  公开仓库根（默认路径）时，根目录就是公开仓库，行为与现状一致。
- **local 构建在所属根内执行。** overlay 根下的 local package 以该根为 cwd、按其
  自己的 npm workspaces 构建；公开仓库的根 `package.json`、`package-lock.json` 与
  `.npmrc` 不因 overlay 源码而变化。
- **定制可声明所需 npm scope（`npmScopes`）。** 条目声明安装时需要解析的 scoped
  registry（如 `@example`）；sync 在任何物化动作前检查 profile 的 npm 配置
  是否已为每个 scope 配置 registry，缺失即报错退出。sync **不写入**任何 registry
  配置：映射由每台机器手工配置，公开仓库不出现内部 registry 地址。
- **overlay 不得借 npm 包名顶替公开 package。** overlay 条目的 npm 包名与公开
  manifest 中任一 package 或顶层 `dependencies` 的包名相同时拒绝运行（现有规则只比较 id）。
- **启动清单按所属根解析 local 包名**，使 overlay 根下的 local package 出现在清单中。
- **源码预检先于一切物化。** 所有启用条目的源码存在性与「不越出所属根（含符号链接）」
  在任何部署面变化前统一检查，失败即退出且部署面不变。这同时收紧了公开条目的行为：
  此前缺源码时 sync 会非零退出但已部分物化（patch 文件被重写、其余 skill 被复制）。
- **升级检查与自动升级识别 overlay。** 升级检查按包 scope 从 profile npm 配置解析
  registry；自动升级只改写公开 `dsh.yaml`，overlay 条目提示手动升级而不再使命令报错。
- **overlay 与公开仓库同等可信。** 越界与预检只拦截配置错误(路径写错、私有仓库未克隆),
  不以防御恶意 overlay 为目标。
- **加载不读源码。** 读 local 包名等依赖源码的步骤移到源码预检之后;`--reset` 与禁用条目
  的清理在私有仓库缺席时仍能完成。
- **npm spec 与 `name` 必须一致**,防止以假 `name` 绕过包名唯一性。
- **`DSH_LOCAL_MANIFEST` 必须是绝对路径**，相对路径报错而不是按当前目录解析。
- **仓库测试不读取外部 overlay。** `npm test` 运行时屏蔽 shell 中导出的
  `DSH_LOCAL_MANIFEST`，避免私有 overlay 串进公开仓库的测试结果。

非目标：不新增环境变量或第二个 overlay 层（仍是单一 overlay，由
`DSH_LOCAL_MANIFEST` 指向私有仓库内的文件）；不由 sync 拉取、克隆或更新私有仓库；
不允许 overlay 写入 profile 的 registry 配置；不改变 `hostRuntimeCompatibility`
的归属规则；不迁移具体的私有定制（由私有仓库自行完成）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `repo-layout`:
  - 「本地 manifest overlay 追加不可公开定制」：新增 overlay 根的定义、源码与构建
    按所属根解析、npm 包名不得顶替公开 package。
  - 「manifest 支持本地与远端两种定制来源」：local 源码位置从固定的
    `packages/<id>/` 改为所属根下的 `packages/<id>/`。
  - 新增「定制可声明所需 npm scope 且 sync 在变更前校验」。
  - 新增「仓库测试与本机 overlay 隔离」。

## Impact

- `scripts/lib/manifest-overlay.mjs`：条目携带所属根；新增 npm 包名冲突检查的输入。
- `scripts/sync.mjs`：`npmNameOf`、`runLocalBuild`、`localBuildInputHash`、
  local spec 路径修复、`syncPackages` 的 local 目录、`syncDirs`、`syncPatches`
  均改为按条目所属根解析；新增 `npmScopes` 字段校验与安装前检查。
- `scripts/sync.mjs` `main()`：新增源码预检与 scope 预检，位于一切物化之前；
  `GENERATED_HEADER` 措辞。
- `scripts/plugin-list.mjs`：local 包名按所属根解析。
- `scripts/lib/plugin-updates.mjs`：已配置 registry 的 scope 改走 `npm view`(带认证)；`scripts/plugin-update.mjs`：
  排除 overlay 行。
- `package.json` `test` 脚本：屏蔽 `DSH_LOCAL_MANIFEST`。
- `tests/`：扩展 overlay 测试覆盖外部根的 local package / patch / skill、构建 cwd、
  scope 检查与包名冲突。
- `docs/notes/local-manifest-overlay.md`：补充私有同构仓库的布局与多机接入步骤。
- 已部署的 local package spec 含绝对路径；overlay 根迁移时由既有路径修复逻辑处理。

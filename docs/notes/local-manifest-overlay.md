# 本地 manifest overlay（`dsh.yaml.local`）

对应 OpenSpec change `local-manifest-overlay` 与 `internal-overlay-repository`，规范见
`openspec/specs/repo-layout/spec.md` 的「本地 manifest overlay 追加不可公开定制」与
「定制可声明所需 npm scope 且 sync 在变更前校验」。本文只讲怎么用与边界；设计理由见
两个 change 的 `design.md`。

## 为什么存在

本仓库是**公开**的部署真相源，但有些定制不可公开：内网 npm 包、内网采集器、
含本机绝对路径的 patch 片段。

旧做法是 `enabled: false` + `enabledEnv: DSH_XXX` + gitignored `.env.local`。
它能做到「默认不启用」，**但做不到「不公开」**——公开 manifest 里仍然要写出内网
包名、内部 registry、maintainer 与内部服务描述。overlay 解决的是后者。

## 用法

默认路径是仓库根 `dsh.yaml.local`（已 gitignore）。结构与 `dsh.yaml` 的
`customizations` **完全同构**，条目字段语义一致（含 `note` / `brief` /
`enabledEnv` 等），审查记录随条目留在该文件内：

```yaml
customizations:
  - id: some-internal-package
    type: package
    source: remote
    spec: '@scope/pkg@1.2.3'
    version: 1.2.3
    enabled: true
    brief: 内部包的短备注
    note: '来源、审查日期、信任面分析……'
```

改完照常 `dsh build`（或 `node scripts/sync.mjs`）物化。

## 边界（都是 fail closed）

overlay **只能追加定制条目**：

| 行为 | 结果 |
|-|-|
| 追加新 id 的定制 | ✅ 与写在公开 manifest 中不可区分 |
| id 与公开 manifest 重复 | ❌ 报错（不允许覆盖公开条目） |
| overlay 内部 id 重复 | ❌ 报错 |
| 声明 `dshVersion` / `autoUpdate` / `web` / `agentInstructions` / `dependencies` | ❌ 报错 |
| 文件不存在 | ✅ 静默按公开 manifest 运行（常态） |
| 文件存在但不可读/不是映射 | ❌ sync 报错；启动清单降级但不阻断 |

overlay 条目走**完全相同**的校验链路，不因来源是本地文件而放宽：必填字段、
`source: remote` 的精确版本 pin、`deps` 引用完整性、`enabledEnv` 命名，以及
`hostRuntimeCompatibility` 的运行体版本围栏（该围栏把公开 + overlay 合并计数，
「至多一个拥有者」的断言对 overlay 同样生效）。

## 私有同构仓库（overlay 根）

overlay 文件所在目录就是它的**所属根**（`dirname(realpath(overlay 文件))`）。overlay 条目
的源码一律从所属根取，布局与公开仓库同构：

```text
<R>/                      # 私有仓库根，例如 ~/.dsh-local
├── dsh.yaml.local        # overlay 本体
├── package.json          # workspaces: ["packages/*"]，有自己的 lockfile
├── package-lock.json
├── packages/<id>/        # overlay 的 local package
├── patches/<id>.yml      # overlay 的 patch 片段
└── skills/<id>/          # overlay 的 skill
```

- 公开条目只从公开仓库取源码，overlay 条目只从 `<R>` 取；两边互不回落。
- `<R>` 中 local package 的构建以 `<R>` 为工作目录执行
  `npm run build --workspace <name>`，构建依赖装在 `<R>` 自己的 `node_modules`，公开
  仓库的 `package.json` / lockfile 不受影响——**每个根一个 lockfile**。
- `buildInputs`、`compatDependencies` 的路径都相对所属根，且 realpath 不得越出所属根。
- 公开仓库根的 `dsh.yaml.local` 若是指向 `<R>/dsh.yaml.local` 的符号链接，所属根是
  链接**目标**所在目录 `<R>`，不是公开仓库根。

**信任模型。** overlay 根与公开仓库同等可信：它能声明 local package，而 local package
会在本机执行构建脚本并被 DSH 加载。只把自己控制的仓库作为 overlay 根。

## 多机接入

`DSH_LOCAL_MANIFEST` 指定 overlay 的**绝对路径**，**取代**（而非叠加）默认路径；
相对路径会被拒绝（sync 报错，启动清单降级并在 stderr 提示）。每台机器：

```bash
git clone <private-repo-url> ~/.dsh-local
(cd ~/.dsh-local && npm ci)                 # 私有 package 的构建依赖
# 公开仓库根 .env.local（gitignored，bin/dsh 会 source 它）加一行：
echo "export DSH_LOCAL_MANIFEST=$HOME/.dsh-local/dsh.yaml.local" >> .env.local
# 若 overlay 条目声明了 npmScopes，给 profile 配好 scope registry（sync 不会替你写）：
echo "@example:registry=https://registry.example.com/" >> ~/.dsh/profiles/web/.npmrc
dsh build
```

`git pull` 私有仓库后重新 `dsh build` 即可在各机器保持一致。**不要**指望
cockpit/联邦分发 overlay——联邦控制面明确声明「不同步文件」，且其设计前提是远端保持
独立安装；理由记在 `local-manifest-overlay` 的 `design.md` Decision 5。

## `npmScopes`

package 条目可声明安装所需的 npm scope：

```yaml
  - id: some-internal-package
    type: package
    source: remote
    spec: '@example/pkg@1.2.3'
    version: 1.2.3
    enabled: true
    npmScopes: ['@example']
```

- 加载阶段校验：只能出现在 `type: package` 上，值是 `@scope` 列表。
- 在 profile 骨架存在之后、任何定制物化与账本迁移之前，sync 以 profile 目录为 cwd 运行
  `npm config get <scope>:registry`（与安装时 npm 的解析一致：用户 `~/.npmrc`、
  profile `.npmrc`、`npm_config_*` 都算）。未配置即报错退出，错误信息给出 scope、
  条目 id 与 profile 目录。
- sync **只校验、不写入** registry 配置；禁用条目不参与校验。
- `npm_config_registry`（默认 registry）不能满足 scope 校验。

升级检查对 scoped 包：该 scope 在 profile 中配置了 registry 时，经 `npm view`（cwd 为
profile 目录）取元数据，从而使用与安装相同的 registry 与认证；否则走默认 registry。
每一行带 `fromOverlay`。`plugin-update` 只改写公开 `dsh.yaml`，overlay 条目的升级
只提示「需在 overlay 中手动升级」，不改写、不提交。

## 源码预检与回滚

常规 sync 在写入 `$DSH_HOME` 之前先做**源码预检**：所有启用条目的源码文件（patch 片段、
skill 目录、local package、compat 依赖、`buildInputs`、运行体构建器）必须存在，且
realpath 不越出所属根。任何一项失败都一次性列出全部问题并退出，`$DSH_HOME` 不变。
随后求出所有 package 的 npm 包名，并检查它们与顶层 `dependencies`、
`compatDependencies` 在 profile `package.json` 的同一键空间内唯一——overlay 不能用
另一个 id 顶替公开 package。

- **禁用私有插件、而私有仓库暂时不在：** 禁用的 local 条目缺少 `package.json` 时视为
  不在 manifest 中，sync 依据部署状态账本把它移除，不需要源码。
- **撤销全部部署：** `node scripts/sync.mjs --reset` 不做源码预检、不解析包名，私有
  仓库或运行体构建器缺失时也能完成。
- **完全退出 overlay：** 删除 `.env.local` 中的 `DSH_LOCAL_MANIFEST` 行（以及仓库根的
  `dsh.yaml.local`），再 `dsh build`；overlay 条目会按「从 manifest 删除」被卸载。

## 已知约束

- **审查记录离开版本控制。** overlay 条目的 `note` 没有 git 历史。缓解办法就是
  上面的私有 repo。这是有意接受的 trade-off——替代方案是把内网信息留在公开仓库。
- **worktree 里默认没有 overlay。** gitignored 文件不随 `git worktree add` 复制，
  所以 `.worktrees/*` 下运行 sync 会按公开 manifest 走（不报错）。需要时用
  `DSH_LOCAL_MANIFEST` 指向仓库外的稳定路径。
- **仓库测试与本机 overlay 隔离。** `npm test` 把 `DSH_LOCAL_MANIFEST` 设为一个不存在的
  绝对路径，本机 overlay 不会影响测试结果；需要 overlay 的测试自带临时 fixture。
- **生成文件不写出 overlay 位置。** `cordis.patch.yml` 的标记头只写「plus the local
  manifest overlay, if any」，不含私有仓库路径。
- **公开仓库不体现 overlay 的存在。** 这是刻意的：「这台机器装了什么内网东西」
  本身就不该公开，所以不加任何计数或存在性声明。

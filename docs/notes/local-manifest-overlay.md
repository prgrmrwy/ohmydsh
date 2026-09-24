# 本地 manifest overlay（`dsh.yaml.local`）

对应 OpenSpec change `local-manifest-overlay`，规范见
`openspec/specs/repo-layout/spec.md` 的「本地 manifest overlay 追加不可公开定制」。
本文只讲怎么用与边界；设计理由见该 change 的 `design.md`。

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

## 多机共享

`DSH_LOCAL_MANIFEST` 环境变量可指定 overlay 的绝对路径，**取代**（而非叠加）
默认路径。因此推荐做法与 memex 库同形态：

```bash
# 一次性：把 overlay 放进私有 repo
mkdir -p ~/.dsh-local && cd ~/.dsh-local && git init
# 之后每台机器
export DSH_LOCAL_MANIFEST=~/.dsh-local/dsh.yaml.local
```

三台机器 `git pull` 即一致，无需任何额外开发。**不要**指望 cockpit/联邦分发
overlay——联邦控制面明确声明「不同步文件」，且其设计前提是远端保持独立安装；
理由记在 change 的 `design.md` Decision 5，不必重新讨论。

## 已知约束

- **审查记录离开版本控制。** overlay 条目的 `note` 没有 git 历史。缓解办法就是
  上面的私有 repo。这是有意接受的 trade-off——替代方案是把内网信息留在公开仓库。
- **worktree 里默认没有 overlay。** gitignored 文件不随 `git worktree add` 复制，
  所以 `.worktrees/*` 下运行 sync 会按公开 manifest 走（不报错）。需要时用
  `DSH_LOCAL_MANIFEST` 指向仓库外的稳定路径。
- **公开仓库不体现 overlay 的存在。** 这是刻意的：「这台机器装了什么内网东西」
  本身就不该公开，所以不加任何计数或存在性声明。

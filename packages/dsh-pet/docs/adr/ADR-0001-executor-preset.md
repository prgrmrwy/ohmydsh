# ADR-0001: Pet executor 使用专用 preset 而非 scoped provider 隔离 Skill

- **Status**: Accepted
- **Date**: 2026-09-02
- **Relates to**: OpenSpec change `add-dsh-pet`（spec 第 219、249 行）

## Context

Pet 的规范要求：**只有在 Pet 允许清单中显式启用的 Skill**，才可以对 executor
发布、加载或注入；全局存在但未被 Pet 启用的同名或异名 Skill 一律不得进入
model-facing catalog（spec.md:249）。

原实现的做法是在 executor 的 scoped context 上注册 Pet 自己的 allowlist
provider，并在代码注释中声称「the broad `tool-skill` filesystem catalog is
omitted or shadowed there」。

**这个假设是错的。** 代码审查后核实：

```js
// @deepseek-ai/dsh-skill/lib/index.js:299
const layers = [this.layers.global, ...this.layers.chainLayers(options.scope)]
```

`collectFresh` **无条件**把 global 层并入合并结果。scoped 注册是**加法**——
它可以往目录里添加条目，但无法减去别人已经注册的 provider。

而 `skill-filesystem` 恰恰由官方 `standard` preset 加载（该 preset 的
`agent.cordis.yml` 第 83 行），它贡献 `$DSH_HOME/skills`、`~/.agents/skills`
以及 executor cwd 下的 project roots 发现。于是 executor 继承 `standard` 时，
**用户全局安装的每一个 Skill 都对 Pet executor 可见且可被 `skill` 工具加载**。

## Decision

新增 `presets/dsh-pet-executor`，从官方 `standard` 复制并**仅移除
`skill-filesystem`**，Pet 创建 executor 时默认使用它。

保留 `tool-skill`：executor 仍然需要目录与加载器，只是它看到的目录完全来自
Pet 的 allowlist provider。

## Consequences

**取舍**：这与 `add-dsh-pet` tasks 4.3 中「Pet 不自带 package 私有
composition」的结论相反。当时的判断是「仅当出现明确需求时才重新评估」——
授权边界失效就是那个需求，且是唯一已知的、无法用其它手段满足的需求。

**为什么不选其它方案**：

- **在 `skill` 工具调用处做二次校验**：`tool-skill` 是官方插件，Pet 无法在
  其内部插入检查；而且泄漏发生在 catalog 层，模型在调用前就已经看到了不该
  看到的 Skill 名称与描述。
- **向 DSH 提 scoped-exclusive 能力**：正确的长期方向，但需要上游改动，
  在此之前边界一直是破的。
- **让 Pet 的 provider 返回「完整目录」信号**：`SkillProvider` 契约里的
  `complete` 只影响缓存，不排除其它层。

**维护成本**：该 preset 是 `standard` 的副本，官方升级 `standard` 时不会自动
跟随。已加测试断言它与 `standard` 的差异**恰好只有 `skill-filesystem`**，
一旦官方新增插件而副本未跟进，需要人工同步——这是可见的、有测试兜底的债务，
优于一个静默失效的安全边界。

**用户仍可覆盖**：设置面板的「Agent 预设」允许选择其它 preset。选 `standard`
会重新引入泄漏；这是用户的显式选择，不是默认行为。

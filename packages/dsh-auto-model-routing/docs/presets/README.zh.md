# 判档预设（judgement presets）

[English](README.md)

判档预设是包内置、带名字和来源的一组 Jev 问题文本。用户在设置页「判档预设」里选择用哪一个；缺省是 `reasoning-depth`。

预设**只**决定 Jev 看到的问题（`rubric.json`）和一个固定集合里的上下文行（目前只有 `execution`）。depth 偏移、effort 上限、家族起点 effort 和子模型能力槽都不归预设管，切换预设不会改变这些规则。

| id | 文档 | 一句话 |
|---|---|---|
| `reasoning-depth`（缺省） | [reasoning-depth.md](reasoning-depth.md) | depth 按推理难度判断 |
| `effort-as-verification` | [effort-as-verification.md](effort-as-verification.md) | depth 按需要的验证与边界情况投入判断 |

## 预设和版本的区别

预设可以并存，由用户自己选，不会自动升级，也不会自动迁移用户已选的预设。新增预设时，名字描述它的判断思路，不加序号或日期后缀。运行时记录只写预设 id，不写任何版本键。

## 新增一个预设

1. 新建 `src/presets/<id>/rubric.json`。标签集合必须与现有预设完全相同：capability 为 `bounded/analytical/frontier/insufficient_context`，depth 为 `lower/baseline/higher`。
2. 在 `src/presets/index.ts` 的 `PRESETS` 末尾追加一条记录，填写中英标题、摘要、证据说明、`https` 来源和 `context`。
3. 在 `test/presets.test.ts` 的锁定表 `LOCK` 末尾追加该 id 的 `rubricSha256` 与 `context`。
4. 新建 `docs/presets/<id>.md`，写明来源、要点、与其它预设的差异以及已知限制。

## 已发布预设不可原地修改

**锁定表里已有的条目是只读的，只能追加新 id。** 想调整某个已发布预设的判断内容（`rubric.json` 的字节或 `context`），就新建一个预设，不要修改原来的。标题、摘要、证据说明和来源不在锁定范围内，可以随时改。

锁定测试只能发现内容和锁定表对不上。如果有人同时改了 rubric 和它的锁定条目，测试拦不住。所以评审新增或修改预设的 PR 时，要对照上一次发布的锁定表确认：已有条目一行都没变，只多了新行。

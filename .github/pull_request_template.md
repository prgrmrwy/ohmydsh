<!--
感谢贡献!请填写以下内容,尽量简洁但完整。
标题建议遵循 Conventional Commits,例如:fix(sync): 修复 ...
-->

## 动机 / Why

<!-- 这个 PR 解决什么问题?为什么需要它? -->

## 改动内容 / What

<!-- 简要说明关键改动。若改了 dsh.yaml 或定制,请说明影响的物化行为。 -->

-

## 关联 / Links

<!-- 关联 Issue、OpenSpec change 或 ADR;没有就写 N/A -->

- Closes #
- OpenSpec change:`openspec/changes/<name>`
- 相关 ADR / notes:

## 验证 / Verification

> ⚠️ 请只勾选**实际运行过**的检查,并粘贴关键输出。不要声称未执行的验证已通过。

- [ ] `npm test`
- [ ] `npm run check:artifacts`
- [ ] `node scripts/sync.mjs`(并确认**连续运行第二次无变化**,幂等)
- [ ] package 内独立的 build / typecheck / test(如适用)
- [ ] 手工验证(请在下方描述步骤与结果)

<details>
<summary>验证输出</summary>

```
在此粘贴关键命令输出
```

</details>

## 检查清单 / Checklist

- [ ] 已阅读 [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md)
- [ ] 提交信息遵循 Conventional Commits
- [ ] 未直接修改 `~/.dsh` 部署产物,改动都回写到仓库真相源
- [ ] remote 定制使用**精确版本 pin**,并在 `note` 中记录来源与审查结论
- [ ] 自研 package 有语义变化时已 bump `package.json` 与 manifest 的 `version`
- [ ] 未提交构建产物、nested lockfile、raw evidence 或密钥
- [ ] 涉及行为变化时,已更新对应的 `openspec/specs/` 或文档

## 风险与兼容性 / Risks

<!-- 是否影响幂等性、安全边界、现有部署或第三方信任面?如何回滚? -->

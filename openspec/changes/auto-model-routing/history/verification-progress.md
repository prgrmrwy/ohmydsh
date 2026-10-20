> **2026-10-20：以下为首版（本地规则，`13f1587b`）的实施与验收记录，范围已被修订取代，仅作历史参考。**

# 自动路由验收进度（非最终放行）

截至本轮，实施未提交，已暂存主要交付文件；规划提交为 dcfcfdb。不部署、不合入、不归档，package 与 skill 默认禁用。

## 当前证据

- `npm --prefix packages/auto-model-routing run typecheck`：源码及全部测试通过。
- `npm --prefix packages/auto-model-routing test`：41 pass，0 fail，0 skip，9 个文件。
- 33 个规范场景各映射一次，具名测试全部存在，台账全绿；组合场景额外展开参数及回归用例。
- `npm --prefix packages/auto-model-routing run build`：通过。
- `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/auto-model-routing-sync.test.mjs`：1 pass；实际 sync.mjs + 测试 DSH CLI，临时 DSH_HOME，两次同步第二次无变化，不冒称真实安装 CLI 或 GUI 验收。
- `node --test tests/repo-docs-governance.test.mjs tests/manifest-runtime-deps.test.mjs`（带隔离环境变量）：30 pass，0 fail。
- `npm run check:artifacts`：暂存新包后通过。
- `git diff --cached --check`、`git diff --check`：通过。
- `openspec validate auto-model-routing --strict`：通过。
- 重新核对 proposal/design/README/spec SHA256，均等于 round5 定点复核的批准输入，审查未失效。

## 尚不能放行的原因

- 最后整仓 `npm test` 仍返回 1，唯一报告失败为既有 facade 测试：英文根 README 未列 ponytail 与 ponytail-skills；另有 2 条现有 MCP 环境测试跳过。未弱化、删除或过滤这些测试。此前 OpenSpec 构建前提已补建，其 6 项测试均通过。
- 当前 GUI 现场位置、切模式和真实子会话委派仍待用户授权启用。离线 client 渲染测试不是现场验收。
- 最终实现复查与交付证据仍待收尾；不会把此进度报告标为 verify PASS。

## 已补的验收边界

无 effort 锚点移除字段；复原在同 step retry、header 前真实取消/失败后持续；模型不匹配等待；复原跨用户回合优先且不恢复旧 AUTO 缓存；同回合换实际模型重新映射 effort；历史 user pick 投影不被 AUTO header 污染。

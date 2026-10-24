# W4 本地实现证据（memex，0.2.0 依赖，隔离 DSH_HOME；未部署）

用户决定：memex 只支持 0.2.0（回滚即整体回退到切换前 commit）。

## 4.1 消息来源
- 自有 kind `plugin:dsh-memex`，与上游 v3→v4 迁移给历史 memex 行的改名一致（session-format-v3-to-v4 `producerKind`），新旧历史读作同一 producer。
- `test/lifecycle-v4-reload.test.ts`：真实 AgentLoop + `dsh-session-persistence-jsonl` 写盘，新 Host 经 `sessionPersistence.open(...,'read')` 读回。
  对照：改回 `kind:'plugin'` 时读回抛 `SessionFormatError: format v4 message requires a producer-owned source kind`。
- `agent/created` 监听器显式返回 `undefined`（0.2.0 串行签名）。

## 4.2 Host 配置
- `Config` 为 Schemastery 对象：`internalHosts/internalDomains` 普通字段，`autoDerive/scopes/bindings/workspaces` `.volatile()`。
  跨字段规则（重复 scope、共享库目录、绑定）在 mount 时与 `internal/config` 钩子里执行——loader 的 volatile 提交与设置写入都先过这个钩子。
- 运行时订阅插件自身 fiber 的 `loader/volatile-update` 替换 resolver；不再依赖 `settings` 服务（`ctx.inject` 只剩 tools/skills）。
- `test/config-runtime.test.ts`（真实 `cordis-plugin-loader` + `entry.update`，仿上游 live-config 夹具）：热更新不重挂；非法候选写前被拒；
  绕过预检直接进 loader 的非法编辑保持 last-good 路由。红灯：去掉 `.volatile()` 5 例失败，去掉钩子 2 例失败。
- 移除 devDep `dsh-settings-file`；新增 devDep `cordis-plugin-loader`、`dsh-session-persistence-jsonl`。

## 4.3 设置页
- `settingsScope.bind` → `configForms.get('dsh-memex')`（0.2.0 按 entry id 寻址）；`inject` 改为 `configForms`。
- 0.2.0 `ConfigForm.mutate` 被拒时 resolve `false` 而非抛错：页面据此显示「保存被拒绝」并保留草稿。新增用例对旧逻辑红。

## 4.4 配置迁移（sync 侧，见 design D3「W4 定案」）
- `scripts/lib/legacy-settings.mjs` + `syncPatches`：0.2+ 时 mergeConfig 行改为区段下方的运行时所有行；
  种子 = org 键 + `settings.yaml` 的 dsh-memex 分节；已有行只更新 org 键；锚行防止运行时追加落进区段。
- `tests/sync-patch-ownership.test.mjs` 22 例，其中 `tests/helpers/config-editor-write.mjs` 逐行复刻 dsh-config-editor 0.2.0-rc.2 的写入：
  表单保存落在运行时行、再 sync 为空操作；org 改动只改其键；旧分节被带入且只种一次；已有行不重种；坏输入整次失败且不写文件；0.1.x 行为不变。
  红灯：关闭该路径时 5 例 0.2+ 用例失败。
- 当前 `~/.dsh/settings.yaml` 的 dsh-memex 分节只有 `scopes: []`（只读核对键名与形状，未读值以外内容）。

## 结果
- dsh-memex：build / typecheck ok，28 文件 350 测试通过。
- 根 `npm test`：277 / 274 pass / 1 fail（Pet 版本守卫，W5 消除）/ 2 skipped；`check:artifacts` ok。

## 留给候选 / devbox（4.5、3.8）
设置页增删 scope → 立即生效、`dsh build` 两次后仍在、org 键仍生效；上游首启导入后 `settings.yaml.imported` 出现且无告警；逐工作区路由与 0.3 快照一致。

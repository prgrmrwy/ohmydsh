## 1. 先写失败的测试

- [x] 1.1 `packages/dsh-memex/test/channel-delete.test.ts`：
  - 删除命名空间下的发现型库并报告卡片数；
  - 拒绝配置已声明的库、拒绝非发现型（derived/config）库；
  - 拒绝 home 不等于 `<namespace>/<name>` 的情形；
  - 拒绝仍有其它 scope 解析到同一目录的库。

## 2. 实现

- [x] 2.1 `src/contract.ts`：`MEMEX_DELETE_ENDPOINT`、`MemexDeleteRequest` / `MemexDeleteResult`。
- [x] 2.2 `src/host/channel.ts`：`runDelete` 四道证明（未声明 / 发现型 / 路径形状 / 无人解析）。
- [x] 2.3 `src/client/page.tsx`：清单行新增删除按钮、确认态（绝对路径 + 卡片数）、`runDelete`；
      `locales.ts` 增删除相关文案；`styles.ts` 增危险按钮样式。

## 3. 规范与文档

- [x] 3.1 delta spec 修改「未声明的库可见且可声明」，补删除动作与拒绝条件。
- [x] 3.2 中英 README 的「记忆」设置页小节补一句删除入口。
- [x] 3.3 `package.json` 0.4.6 → 0.4.7、`dsh.yaml` 版本与 note、CHANGELOG 条目。
  - 2026-11-08 补证：[英文 README](../../../packages/dsh-memex/README.md#L145)与[中文 README](../../../packages/dsh-memex/README.zh.md#L141)均已说明删除入口、二次确认、绝对路径与卡片数；[package.json](../../../packages/dsh-memex/package.json#L3)与[manifest](../../../dsh.yaml#L118)均为 0.4.7，[CHANGELOG](../../../packages/dsh-memex/CHANGELOG.md#L7)已有 11-04 的发布条目。本轮校正旧任务框，没有重新升版。

## 4. 校验

- [x] 4.1 包内 `npm run typecheck`、`npm run build`、`npx vitest run`：826 passed（既有 eval 基线失败不变）。
- [x] 4.2 仓库级 `npm test`、`check:artifacts`、`openspec validate … --strict`。
  - 2026-11-08：基线 32b9e763 上为 777 项（774 通过、3 跳过、0 失败）；任务分支同步上游 4ea30ebd 并按锁文件重新安装后，完整仓库测试为 785 项（782 通过、3 跳过、0 失败）。`check:artifacts` 和本 change 严格校验退出 0。GUI 的 fail/blocked 不因此改判。

## 5. 部署

- [x] 5.1 `node scripts/sync.mjs` 两次确认幂等；重启 DSH 后核对：清单出现删除按钮、确认行显示绝对路径与卡片数、
      删掉一个空库后清单与目录都消失。
  - 2026-11-08：[实测摘要](checking/summary.md)确认两卡库物理删除、声明/busy 拒绝与真实权限失败；D07 结果缺卡数、D08 页面残留条目确定 fail。空库 D15 在原窗口耗尽后未提交，仍存在；确认区裁切保持人工项。5.1 继续未完成，change 不归档，没有重新部署或重启日常 Host。

## 归档说明（2026-11-13）

经用户批准归档。0.4.7 在真实使用中删除后清单行不消失（即 11-08 验收的 D08）：解析器记住了已列出过的发现型库。0.4.8（`5239866b`）修复并补卡片数提示（D07）；用户在重启后的日常 Host 上实际删除一个库，确认清单行立即消失。11-08 验收里的 D10、D11、D15 与确认区横向裁切没有重新验证。

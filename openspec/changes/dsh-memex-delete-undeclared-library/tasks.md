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
- [ ] 3.2 中英 README 的「记忆」设置页小节补一句删除入口。
- [ ] 3.3 `package.json` 0.4.6 → 0.4.7、`dsh.yaml` 版本与 note、CHANGELOG 条目。

## 4. 校验

- [x] 4.1 包内 `npm run typecheck`、`npm run build`、`npx vitest run`：826 passed（既有 eval 基线失败不变）。
- [ ] 4.2 仓库级 `npm test`、`check:artifacts`、`openspec validate … --strict`。

## 5. 部署

- [ ] 5.1 `node scripts/sync.mjs` 两次确认幂等；重启 DSH 后核对：清单出现删除按钮、确认行显示绝对路径与卡片数、
      删掉一个空库后清单与目录都消失。

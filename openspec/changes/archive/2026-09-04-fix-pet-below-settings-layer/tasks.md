## 1. 样式改动

- [x] 1.1 `packages/dsh-pet/src/client/styles.ts`：把 `.dshpet-root` 的
      `z-index:2147483000` 改为 `z-index:999`。
- [x] 1.2 更新 `.dshpet-root` 上方的解释注释：说明 `999` 取自"已知官方
      Settings 弹层 `1000` 减一"，并简要记录判断依据（同一根层叠上下文，
      严格小于而非等于，避免 DOM 顺序决定胜负）；保留原有关于
      "CONTAINING BLOCK 问题，z-index 不能修复挤压"的说明不变（`index.tsx`
      与 `styles.ts` 中都有，两处都要保留，不要因为顺带改动误删）。

## 2. 测试

- [x] 2.1 在 `packages/dsh-pet/test/client.test.ts` 新增一条用例：断言
      `.dshpet-root` 的 `z-index` 精确等于 `999`（而不是现有的
      `z-index:\d+` 占位正则），失败信息应能一眼看出是数值被改动而非格式
      被破坏。
- [x] 2.2 新增一条回归用例，编码本次修复的核心不变量——`.dshpet-root` 的
      `z-index` 数值 MUST 满足 `100 < z-index < 1000`（下界：高于已观测的
      普通内容最高值 `100`；上界：严格低于已知 Settings 弹层值 `1000`，
      注释写明这两个边界数值的来源，方便未来官方数值变化时定位此测试）。
- [x] 2.3 检查现有 "keeps the mascot and the clamp size in agreement" 用例
      （断言 `` `.dshpet-root{position:fixed;z-index:\d+;width:${declared}px` ``
      的那条）：确认新数值 `999` 下该正则仍然匹配，无需改动断言本身，但
      跑一次确认非误伤。
- [x] 2.4 反向验证：临时把 `.dshpet-root` 的 `z-index` 改回一个 ≥1000 的值
      （例如 `2147483000`），确认 2.1 与 2.2 两条新用例均失败；再改回
      `999` 确认恢复通过。完成后不保留临时改动。
      —— 实测：改回 `2147483000` 后两条新用例均失败（`expected 2147483000
      to be less than 1000`），恢复后通过，反向验证有效。

## 3. 验证与收尾

- [x] 3.1 运行 `packages/dsh-pet` 包内测试（`npx vitest run` 或包内等价
      脚本）与 `npm run typecheck`（如包内提供），确认全部通过。
      —— 34 文件 / 571 用例通过；typecheck 通过。（首次运行时
      `loader-composition.test.ts` 因缺少 `lib/client.js` 失败，`npm run
      build` 后复跑全绿，与本改动无关。）
- [x] 3.2 运行仓库级 `npm test` 与 `npm run check:artifacts`，确认无回归。
      —— `npm test` 89 通过 / 0 失败；`check:artifacts` 报告 tracked paths
      comply with repository policy。
- [x] 3.3 强制重装部署到 `$DSH_HOME` 并比对产物哈希，确认浏览器加载的是
      新构建（参考既有 Pet 变更的部署验证方式）。
      —— 隔离 DSH_HOME 与日常 `~/.dsh` 两处均验证：源构建与部署副本
      `lib/client.js` 哈希同为
      `d9f4f9c7eae23708f157714a8a5cfb9d8b698e19733f0e5ae57545995479e82a`，
      部署产物中实际声明为 `z-index:999`，`z-index:2147483000` 声明数为 0
      （bundle 内残留的该数字仅出现在新写的解释注释文本中）。隔离环境连续
      第二次 sync 报告 `no changes`，幂等性一并验证。
- [x] 3.4 在隔离 DSH home 中启动 Host，人工验证：打开 Settings 面板时 Pet
      （收起态、轮盘展开态、Task 面板打开态三种情况分别验证一次）完全被
      Settings 弹层盖住、不可见于其上；关闭 Settings 后 Pet 恢复正常显示
      与交互。同时复核 D6 既有场景未回归：展开/收起
      `dsh-better-sidebar` 右侧工作台、拖拽调宽全程，Pet 位置不变、不被
      裁剪或压到侧栏之下。
      —— 实际执行方式：经用户选择，未在隔离 home 起 Host，而是直接
      sync 到日常 `~/.dsh` 后由用户重启日常 Host 验证（与 3.5 合并完成）。
      隔离 home 侧完成了部署与哈希验证，未启动其 Host 进程。
      附带发现（与本变更无关，见下）：全新 DSH_HOME 的 profile 骨架把
      `allowBuilds.node-pty` 写为占位符 `set this to true or false`，导致
      better-sidebar / sidebar-qa / cockpit-bridge 三个包安装失败；按
      `dsh.yaml` 已记录的 2026-08-24 信任决定改为 `true` 后恢复，未新增
      信任面。该 bootstrap 骨架缺陷应另开 change 处理。
- [x] 3.5 询问用户后重启其日常 Host，请用户确认真实环境中 Settings 面板
      与 Pet 的层叠关系符合预期。
      —— 用户重启日常 Host 并确认验证成功。
- [x] 3.6 全部验证通过后，运行归档流程（`openspec-archive-change`），把
      `specs/pet-top-layer/spec.md` 的 MODIFIED Requirement 合入
      `openspec/specs/pet-top-layer/spec.md`。

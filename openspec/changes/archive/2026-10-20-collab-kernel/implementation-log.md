# 实施记录

## 2026-10-17：开工与骨架

- 使用 Anvil apply；第 8 轮 APPROVE，不继承旧评审批准。
- 已通过受控 `ws promote`，返回 dependencyMode mutable；仅在当前托管 worktree 安装开发依赖，不部署。
- task 0 的治理表先加入 collab-kernel:C 后运行 `node --test --test-name-pattern='package tiers match' tests/repo-docs-governance.test.mjs`，1 failed：实际包清单缺 collab-kernel（预期骨架尚未创建，并非语法/导入错误）。治理按 Git 已登记路径检查，新包须纳入可见范围后重验，不用放宽断言绕过。
- Luna 子代理完成包骨架与 boundary 两场景；RED 阶段 scanner stub 返回空，boundary-02 的违规列表断言失败，替换为 AST scanner 后两项通过。
- 已 `npm install --ignore-scripts --no-audit --no-fund`：34 added / 2 changed，exit 0；不执行依赖生命周期脚本。
- 新包用 git intent-to-add 纳入既有治理检查视野（未提交或暂存文件内容）。主代理新跑 package test 2 passed、typecheck、build；根文档治理+peer 33 passed；check:artifacts 通过。原有 packages/*/lib 忽略规则已覆盖此包。
- task 0 与 task 1 已更新实际完成状态；后续加强 scanner 反例不改变已批准行为。主代理与各子代理划分不重叠写入范围，不并发改同一文件。

## 根回归前置问题（不属于内核行为失败）

- 首次 npm test：426 tests / 418 passed / 6 failed / 2 skipped。五项 dsh-openspec 升级测试因新 worktree 缺 lib/upgrade-transaction.js、generations.js，在业务断言之前 ERR_MODULE_NOT_FOUND。独立只读诊断确认根测试脚本不执行包 pretest；补运行现有 `npm --workspace packages/dsh-openspec run build` 后该 suite 6/6 通过，未改升级实现或规范。
- 另一项是既有根 README 插件索引未列出 manifest 已启用的 ponytail / ponytail-skills。为既有规范要求补齐中英四条索引链接，不新增能力、配置或运行时行为；保留测试原断言后重验。facade 14/14 通过。重新完整 npm test：426 tests / 424 passed / 0 failed / 2 skipped（既有真实 MCP bridge 集成探针缺精确运行时，不能冒充已验收）。

## FileStore 子任务的 TDD 偏差

- 第一位存储子代理先写实现、后运行新增 7 个聚焦测试，并明确承认未遵守要求的 stub→RED→实现顺序。因此不能把其测试补写声称为 task12 的 test-first 证据，task12 尚未完成。
- 主代理读源码发现完整空行被忽略、记录/JSON 边界和关闭路径缺少回归等风险，已交接另一位实现者按具体失败反例重新验证和修复；后续新增测试的真实 RED/GREEN 与原始偏差分开记录，不改写历史。
- 接管实现者先加反例实跑：file-store suite 36 tests / 24 failed / 12 passed；覆盖非 JSON 值、__proto__、完整空行、磁盘损坏、非法 seq、failed 读取、fsync 顺序和替代锁保护。不是 import/语法故障。

## 额外输入边界测试

- 主代理先写 input-boundaries.test.ts，定向运行 5 tests / 3 failed / 2 passed。合法成员名 constructor 被误报 NAME_TAKEN；同名普通 itemId 误报 BAD_ITEM；createSpace 接受空 cmdId。两项纯读授权和返回值隔离原本通过。失败都来自真实业务断言，已由 core owner 在其批次处理，主代理不并发编辑。

## 测试类型检查前提

- 独立只读核验发现生产 tsconfig 仅 include src，原 Vitest 的“Type Errors none”不足以证明普通 test.ts 被检查。新增 extends strict 的 tsconfig.test.json、排除故意违规 import 夹具，并让 package typecheck 同时检查 src/test，Vitest .test-d 使用该配置。
- 新鲜 `npm --workspace packages/collab-kernel run typecheck` 正确暴露普通测试的 fixture union/故意坏布尔cast/optional children等错误；修正测试类型表达，不放宽产品类型或场景断言。

## 主流程与后续模块

- core 2–11 的按组 RED/GREEN 原始摘要在 test/support/implementation-notes.md（实现者只写其scope）。主代理独立重跑 14 files / 84 tests 全过后更新这些任务与映射；实际类型负夹具和17命令允许/拒绝矩阵均包含。
- FileStore 接管最终40/40绿色；服务+磁盘store.test 12/13绿色，store-06 正确保持RED直到人类决定补齐 breaker/reset 多事件，不提前翻绿。
- 投影/约定首位实现者的初次RED因模块不存在，不能声称符合排除import错误的test-first标准。主代理按独立AST可见文本加强检查，新增所有ASCII标点精确roundtrip及entity文本纯读断言通过；另新增live/recovered投递区分回归先因两类都输出unknown失败，修复后投影7/7通过。
- 当前打包约定的Service默认接线测试先失败 CONVENTION_UNKNOWN；command-snapshot测试先失败因调用后外部修改被当作命令载荷。这些新增正确RED留待service owner收尾后修复，不并发改其文件。
- 补齐dispatch-08/10真实磁盘服务集成测试，先真实运行3失败：缺completed、SPI未执行。后续不以memory替身冒充磁盘恢复。
- 调度首轮定向17失败/4通过，runtime实现后5处断言误取快速completion为命令末行。主代理精确改成按返回seq定位，保留原事件断言，9files25counts全过；旧core三组相同竞态也按seq修，26/26过。额外wake-table4/4覆盖全事件、排除、去重、纯函数与不可达仍reset，presence-sampling2/2证明入队前一次采样和悬挂SPI不阻塞队列/close。
- 默认约定、snapshot与failed replay的正确RED均已修复，额外7/7 green。storage最终53/53后完成任务12；初始流程偏差未删除。
- 独立存储评审 FAIL 发现宽松UTF8会掩盖完整行损坏并误算截断offset。新修复者先47tests/5FAIL（3字节完整性+2错误详情）再修；主代理在相同正确RED窗口全包看到184PASS/5FAIL，未当作完成。修复后独立终态复核PASS，FileStore47/47+service storage13/13，使用原始Buffer边界/严格解码且保护完整坏行字节不变。
- 独立调度评审发现F1/F2生命周期漏洞；独立tests-only首跑service-admission为6RED/2PASS，旧create收据绕过failed/close、pendingopen/read/create会复活。修复者另4RED包含可变principal身份快照，修后admission8/8与extra5/5通过，服务不等外部SPI、只排空存储且隔离旧epoch。

## 最终验证快照

- 2026-10-17 02:38，主代理 `npm --workspace packages/collab-kernel test -- --reporter=dot`：38 files / 205 tests PASS，0skip/todo，Type Errors none；生产与普通测试双tsc的typecheck、build及built ESM入口烟测全部exit0。其后只修正convention集成测试名以匹配ledger，不改断言/产品。
- 根 `npm test` 最终445total /443passed /0failed /2既有MCP bridge探针skip；该确切bridge未装在workspace，不能把skip视为通过或为此擅自改日常profile。artifacts、diffcheck及治理30/30通过。Anvil零skip全仓条件无法声称满足；最终verify必须保留此限制与原TDD偏差。
- 两change使用官方受管openspec显式`--type change --strict --json`主代理核验：valid true/issues[]、两个exit0；主规范38/38。有同步子代理报告另一CLI长正文warning致exit1；不据此改批准规范，最终以本会话官方命令直接输出为证。同步已保持kernel19/108、repo-layout25/127，旧35overlay场景及其他23requirements字节不变。

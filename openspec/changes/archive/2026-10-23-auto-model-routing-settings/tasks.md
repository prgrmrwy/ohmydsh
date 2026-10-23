按 design 实现；每条 spec 场景先写针对性失败测试再实现。路径相对 `packages/auto-model-routing/`。真实 AgentLoop + 回环假 Jev，测试不访问 OpenRouter。源码实施与离线验证进行中；部署/现有 GUI 验收另列，未完成前不归档。

> 第 1–6 节保留首版实施历史；涉及逐模型编辑与旧验收的条目由第 7 节及最新 spec/design 取代，不作为新版已验收声明。

## 1. 配置与解析

- [x] 1.1 写 `settings.test.ts`：普通字段缺省/损坏处理，`mainEfforts[provider][model][tier]`、`childRoutes[provider][tier]` 完整组合、严格写入拒绝未知/凭据字段，显式映射错误不静默恢复默认，原子写入和 0600。
- [x] 1.2 新建 `src/settings.ts`，实现普通设置与稀疏覆盖读取、诊断、合并写入、恢复默认删除覆盖；旧 decisionToast 文件兼容。普通保存不固化缺省路由表。
- [x] 1.3 模型目录、子会话允许列表、effort 支持集合与上限校验器：测试精确 provider/model、跨体系拒绝、max 拒绝、模型缺失、列表未启用/不可读取、保存竞态；普通无关设置可保存且不改写历史失效路由。

## 2. 主子路由行为

- [x] 2.1 写 `effort.test.ts`、`router.test.ts`：主模型精确覆盖优先，未覆盖用原起点算法；缺省算法受上限约束且不突破上限，候选空时透传；显式组合无效则设置错误阻止 AUTO 请求，不当成 Jev 停用。
- [x] 2.2 接入主会话 mainEfforts 与当前设置。配置变动使同回合映射缓存失效但不重新判档，实际 provider/model 改变后正确选用对应配置，设置页编辑对象不影响实际模型。
- [x] 2.3 写并实现 `subagent-tool.test.ts`：childRoutes 精确返回用户配置的 model + effort，缺省格保持原表和起点；不继承主会话覆盖；当前允许列表/模型能力使用时复核，失效返回设置错误、暂停委派，不换路由、不改模式。保留 MANUAL 根会话不判档/不外发语义。
- [x] 2.4 写并实现降低 effortCap 的整体冲突校验：单独降上限被拒并列出所有显式冲突格，同次提交修复后成功；不静默截断显式推荐。
- [x] 2.5 写并实现 Jev 请求期限读取，范围 1000–4500ms；测试 1500ms 失败、2500ms 成功、取消仍不算失败。
- [x] 2.6 写并实现新普通会话默认模式初始化；核验宿主 fresh-create 与 resume/clear/compact 的实际区分，覆盖新建、老会话无状态、重启与子会话，不把 source=startup 未经证明地等同于全新会话。

## 3. 凭据与 Host 端点

- [x] 3.1 凭据读取改为异步官方 credentials.resolve，服务缺失退回 launch environment；测试 A→B→删除在下一次请求生效、启动环境只读、不泄漏。
- [x] 3.2 增加 settings/saveSettings/setKey 端点，复用已认证连接；返回模型展示名、支持 effort、允许列表状态、规则 criteria 原文与诊断，不回传 key。依赖缺失给出明确状态而不影响插件加载。
- [x] 3.3 保存端点完整测试：本次新增/修改的精确路由二次校验、上限涉及所有存续覆盖、列表变化竞态、伪造载荷拒绝、失败文件字节不变；设置操作不调用真实 session selectModel。
- [x] 3.4 key 端点仅经 credentials set/unset，测试只读/服务缺失/非法值/删除；文案正确指导先删启动环境再重启再保存，绝不指导只读状态下先保存。

## 4. 分页设置页与 picker

- [x] 4.1 写 `settings-section.dom.test.ts`：Claude/GPT 页签（内部 codex）、切页保留草稿、页顶主模型选择只切编辑对象；每页四档×主 effort/子推荐两列，主模型目录与子允许列表分开，不展示 Opus 示例列或裸 effort 注释。
- [x] 4.2 用官方 SettingsForm、SettingsSecretField、SegmentedTabs/SegmentedControl、Switch、Tag、Tooltip 组装判档服务/会话/路由映射三个区块；上限放会话分区。只用宿主令牌、自有前缀和作用域，不自带主题。
- [x] 4.3 新建局部 route picker，复用官方 MenuSurface/MenuGroup/图标/定位与焦点工具，不私有导入 ModelSelect、不复制整份组件、不修改 DSH core。子 trigger 显示具体模型名 + effort；根菜单为模型/推理等级，两者可编辑；主格只选 effort。
- [x] 4.4 `route-picker.dom.test.ts`：同体系有效模型过滤、effort 支持/上限过滤、换模型保持有效 effort 或要求重选、失效旧值不可选、Escape 返回、键盘选择、焦点还原、portal 不裁切、各格恢复默认。
- [x] 4.5 info 直接使用共享 rubric.json criteria 原文（或 Host 返回原文），不创建翻译副本；测试四档字符串完全一致、hover 与 focus 可读。
- [x] 4.6 写入中、冲突、部分保存、配置损坏、credentials 不可用、允许列表未启用/移除模型等状态；key 成功但设置失败时明确分别报告，清空密钥草稿、保留设置草稿。加载/保存不得静默丢草稿。
- [x] 4.7 按 design D7 实现 E 导航字形的有界适配；测试只标记本行、label 变化、卸载清理与查找失败回退齿轮。
- [x] 4.8 用真实主题令牌重新核对新分页方案的深浅色、窄栏、长模型名、菜单与 tooltip；旧单表探索截图不算本方案证据，不提交批量截图或临时预览。

## 5. 文档与版本

- [x] 5.1 更新 package 中英文 README：六类设置（路由映射含主、子两组）及缺省行为，主模型精确 effort 覆盖、子 model+effort、GPT/codex 对应、允许列表快照、上限冲突/恢复默认、key 正确迁移与回滚。
- [x] 5.2 更新架构图源与 SVG：设置、credentials、模型目录/允许列表与主子映射读取；同步 dsh.yaml 信任说明，package/manifest 版本改为 0.2.0。

## 6. 验证与交付

- [x] 6.1 运行 package test/typecheck/build，仓库 npm test、npm run check:artifacts，记录真实结果；通过用户授权的部署流程连续 sync 两次，第二次无变化，不自行重启现有 GUI。
- [ ] 6.2 经用户授权重启/刷新后在现有 GUI 验证分页与 picker、草稿不改真实会话、主映射按实际请求头生效、子工具精确返回推荐、上限冲突、白名单收缩、期限、提示、默认 AUTO 与凭据迁移；写本 change 的 verify.md。
- [x] 6.3 `openspec validate auto-model-routing-settings --strict`；实施与验收完成后再同步主规范并按归档流程收尾，不把规划完成当成功能完成。


## 7. 2026-10-23 用户交互修订（前序逐模型证据仅为历史）

- [x] 7.1 更新 proposal/design/spec 与文档：保留表格主列但改为体系统一 effort，删除上方主模型选择器，缺省显示随模型；旧逐模型数据显式诊断与整组恢复，不暗迁移。
- [x] 7.2 测试先行实现 mainEfforts[provider][tier] schema/保存/解析/运行时；验证跨同体系模型一致、另一体系隔离、未覆盖保留各模型算法、全体系支持交集、cap冲突、旧形状fail-closed且可恢复。
- [x] 7.3 更新GUI与测试：无主选择器、主列可编辑、体系草稿保留/恢复默认、子推荐不变；模式/上限/体系 tabs 统一28px/12px紧凑尺寸，自然宽度及层级。
- [x] 7.4 完成包test/typecheck/build与仓库回归、strict校验；新旧证据分开，图文同步。
- [ ] 7.5 在获准部署刷新后补实际GUI能做的部分：所有criteria/菜单、cap冲突/reset、目标验收会话toast/hover；不能安全构造/不可观测逐项标明，不冒称全通过，不归档提交推送。

## 收尾接受记录（2026-10-23）

用户确认新版 GUI 看起来无问题，并明确授权同步规范、带已知缺口归档、提交和推送。6.2 与 7.5 保留未完成：供应商线级证据、旧设计未完整观察的 toast/hover/部分 UI、固定延迟/白名单收缩/能力不兼容异常未完整覆盖；不是产品 FAIL，也不伪装 PASS。6.3 在规范同步与归档校验完成后勾选。

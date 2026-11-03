## Test Plan

测试名即 `it()` 标题，取场景名原文。MODIFIED requirement 中文字未变的沿用场景记为 🟢 existing：它们已有测试，实施时须在原测试文件中定位并保持断言不变（若原测试依赖已退役的补丁能力，需改写为等价断言并改记 🔴 red）。其余场景从 🔴 red 开始。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 代人受理不唤醒 | 既有测试（实施时定位） | `代人受理不唤醒` | 🟢 existing |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不经受理直接完成 | 既有测试（实施时定位） | `不经受理直接完成` | 🟢 existing |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 不能处置非托管成员的 request | 既有测试（实施时定位） | `不能处置非托管成员的 request` | 🟢 existing |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 作者退役后仍可处置 | 既有测试（实施时定位） | `作者退役后仍可处置` | 🟢 existing |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 未授权空间不可区分 | 既有测试（实施时定位） | `未授权空间不可区分` | 🟢 existing |
| specs/collab-kernel/spec.md → 接入方代人处置其托管成员的 request | 处置接入方拥有的普通会话登记的 request | packages/collab-kernel/test/dispose-owned-request.test.ts | `处置接入方拥有的普通会话登记的 request` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以其拥有的普通会话身份执行封闭命令 | 以拥有的会话建空间、邀请并代写 | packages/dsh-collab/test/integration-act-as.test.ts | `以拥有的会话建空间、邀请并代写` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以其拥有的普通会话身份执行封闭命令 | 未拥有、子会话或已归档时拒绝 | packages/dsh-collab/test/integration-act-as.test.ts | `未拥有、子会话或已归档时拒绝` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以其拥有的普通会话身份执行封闭命令 | 提交前失去拥有关系 | packages/dsh-collab/test/integration-act-as.test.ts | `提交前失去拥有关系` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以其拥有的普通会话身份执行封闭命令 | 封闭操作集合 | packages/dsh-collab/test/integration-act-as.test.ts | `封闭操作集合` | 🟢 green |
| specs/dsh-collab/spec.md → 接入方以其拥有的普通会话身份执行封闭命令 | 未提供 owns 的接入方 | packages/dsh-collab/test/integration-act-as.test.ts | `未提供 owns 的接入方` | 🟢 green |
| specs/dsh-pet/spec.md → 子代结算按官方默认通知 locus 主会话 | 结算通知只到 locus 主会话 | packages/dsh-pet/test/locus-settlement-notify.test.ts | `结算通知只到 locus 主会话` | 🟢 green |
| specs/dsh-pet/spec.md → 子代结算按官方默认通知 locus 主会话 | 多个入口结算不打断干活主会话 | packages/dsh-pet/test/locus-settlement-notify.test.ts | `多个入口结算不打断干活主会话` | 🟢 green |
| specs/dsh-pet/spec.md → Locus child 创建使用官方 subagent 契约表达其不变量 | 预留身份后创建 child | 既有测试（实施时定位） | `预留身份后创建 child` | 🟢 existing |
| specs/dsh-pet/spec.md → Locus child 创建使用官方 subagent 契约表达其不变量 | 冷恢复后工具面限制仍然有效 | 既有测试（实施时定位） | `冷恢复后工具面限制仍然有效` | 🟢 existing |
| specs/dsh-pet/spec.md → Locus child 创建使用官方 subagent 契约表达其不变量 | 父在 child 存活期间更改组合 | packages/dsh-pet/test/locus-child-contract.test.ts | `父在 child 存活期间更改组合` | 🟢 green |
| specs/dsh-pet/spec.md → Locus child 创建使用官方 subagent 契约表达其不变量 | child 实际工具面超出允许范围 | 既有测试（实施时定位） | `child 实际工具面超出允许范围` | 🟢 existing |
| specs/dsh-pet/spec.md → Pet executor preset 按运行体的 preset 承载方式声明 | 运行体只接受声明式 preset 时冷恢复 locus child | packages/dsh-pet/test/locus-preset.test.ts | `运行体只接受声明式 preset 时冷恢复 locus child` | 🟢 green |
| specs/dsh-pet/spec.md → Pet executor preset 按运行体的 preset 承载方式声明 | preset 缺失 | packages/dsh-pet/test/locus-preset.test.ts | `preset 缺失` | 🟢 green |
| specs/dsh-pet/spec.md → Pet executor preset 按运行体的 preset 承载方式声明 | locus-base 不含委派 | packages/dsh-pet/test/locus-preset.test.ts | `locus-base 不含委派` | 🟢 green |
| specs/dsh-pet/spec.md → 子代激活受运行体名额约束时 fail closed | 名额已满时创建 locus child | 既有测试（实施时定位） | `名额已满时创建 locus child` | 🟢 existing |
| specs/dsh-pet/spec.md → 子代激活受运行体名额约束时 fail closed | 只读访问不长期占用名额 | packages/dsh-pet/test/locus-capacity.test.ts | `只读访问不长期占用名额` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | locus 主会话归 DSH Pet，入口仍关联干活项目 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | `locus 主会话归 DSH Pet，入口仍关联干活项目` | 🟢 green |
| specs/pet-locus-media-access/spec.md → Locus project-read guard 限制 safe child 文件读取 | Pet 运行目录与来源项目分离 | packages/dsh-pet/test/locus-project-read-guard.test.ts | `Pet cwd does not grant state access; the bound work project remains readable` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 同一干活主会话服务多个入口 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | `同一干活主会话服务多个入口` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | locus 主会话工具面锁死 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | `locus 主会话工具面锁死` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 插件挂入自有作用域的委派工具在执行时被拒 | packages/dsh-pet/test/locus-host-wiring.test.ts | `插件挂入自有作用域的委派工具在执行时被拒` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 干活主会话不得是子会话 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | `干活主会话不得是子会话` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | auto 建立 | packages/dsh-pet/test/locus-establish.test.ts | `auto 建立` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 绑定到已有干活主会话复用 locus 主会话 | packages/dsh-pet/test/locus-establish.test.ts | `绑定到已有干活主会话复用 locus 主会话` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 建立失败不留半成品 | packages/dsh-pet/test/locus-establish.test.ts | `建立失败不留半成品` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首条消息即首个 prompt | packages/dsh-pet/test/locus-lazy-child.test.ts | `首条消息即首个 prompt` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | API 返回前首轮已能解析身份 | packages/dsh-pet/test/locus-lazy-child.test.ts | `API 返回前首轮已能解析身份` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 回调内发布后创建被拒时回滚 | packages/dsh-pet/test/locus-lazy-child.test.ts | `回调内发布后创建被拒时回滚` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 创建失败不推进代际 | packages/dsh-pet/test/locus-lazy-child.test.ts | `创建失败不推进代际` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 名额不足时保留原请求 | packages/dsh-pet/test/locus-lazy-child.test.ts | `名额不足时保留原请求` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | provider 不能证明独立上下文 | packages/dsh-pet/test/locus-lazy-child.test.ts | `provider 不能证明独立上下文` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 干活主会话归档 | packages/dsh-pet/test/locus-rebind-archive.test.ts | `干活主会话归档` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 子会话不可用只换该入口一代 | packages/dsh-pet/test/locus-rebind-archive.test.ts | `子会话不可用只换该入口一代` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 名额不足的冷恢复保留原代际 | packages/dsh-pet/test/locus-rebind-archive.test.ts | `名额不足的冷恢复保留原代际` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | locus 主会话不可用时整体迁移 | packages/dsh-pet/test/locus-rebind-archive.test.ts | `locus 主会话不可用时整体迁移` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型入口按退休规则处理 | 升级只加表 | packages/dsh-pet/test/locus-legacy-retire.test.ts | `升级只加表` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型入口按退休规则处理 | 旧入口首个授权 at | packages/dsh-pet/test/locus-legacy-retire.test.ts | `旧入口首个授权 at` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型入口按退休规则处理 | 旧入口非授权 at | packages/dsh-pet/test/locus-legacy-retire.test.ts | `旧入口非授权 at` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 超时后重试 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | `超时后重试` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 超时前仍阻塞 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | `超时前仍阻塞` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 补偿失败继续阻塞 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | `补偿失败继续阻塞` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 按入口过滤 | packages/dsh-pet/test/locus-context-tools.test.ts | `按入口过滤` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 话题可见所在群条目 | packages/dsh-pet/test/locus-context-tools.test.ts | `话题可见所在群条目` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 子会话向父询问并在同一 current 上继续 | packages/dsh-pet/test/locus-context-tools.test.ts | `子会话向父询问并在同一 current 上继续` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 旧代子会话不能询问 | packages/dsh-pet/test/locus-context-tools.test.ts | `旧代子会话不能询问` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 回复非现行代子会话被拒 | packages/dsh-pet/test/locus-context-tools.test.ts | `回复非现行代子会话被拒` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 启动恢复证据经官方冷读获取 | 合成中断不算证据 | packages/dsh-pet/test/locus-startup-cold-read.test.ts | `合成中断不算证据` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 启动恢复证据经官方冷读获取 | 冷读服务不可用 | packages/dsh-pet/test/locus-startup-cold-read.test.ts | `冷读服务不可用` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 非驻留子会话的权限变更以待应用协议提交 | 非驻留时授予 shell 并在唤醒时生效 | packages/dsh-pet/test/locus-pending-permission.test.ts | `非驻留时授予 shell 并在唤醒时生效` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 非驻留子会话的权限变更以待应用协议提交 | 唤醒时核验失败不留授权 | packages/dsh-pet/test/locus-pending-permission.test.ts | `唤醒时核验失败不留授权` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 非驻留子会话的权限变更以待应用协议提交 | 非驻留撤回 shell 核验失败恢复原值 | packages/dsh-pet/test/locus-pending-permission.test.ts | `非驻留撤回 shell 核验失败恢复原值` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 非驻留子会话的权限变更以待应用协议提交 | 原值也无法核验时不发布 | packages/dsh-pet/test/locus-pending-permission.test.ts | `原值也无法核验时不发布` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 非驻留子会话的权限变更以待应用协议提交 | 常驻空闲时当场生效 | packages/dsh-pet/test/locus-pending-permission.test.ts | `常驻空闲时当场生效` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 受管 finish 正常发送 | 既有测试（实施时定位） | `受管 finish 正常发送` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 旁路不可达 | 既有测试（实施时定位） | `shell 旁路不可达` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档误用 lark-cli 发送被拦截 | 既有测试（实施时定位） | `shell 档误用 lark-cli 发送被拦截` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档读取当前群不被拦截 | 既有测试（实施时定位） | `shell 档读取当前群不被拦截` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档的出站保证如实表述 | 既有测试（实施时定位） | `shell 档的出站保证如实表述` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 子委派不能洗白权限 | 既有测试（实施时定位） | `子委派不能洗白权限` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 收紧层未安装时不发布 | packages/dsh-pet/test/locus-composition.test.ts | `收紧层未安装时不发布` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 隔离能力无法证明时不发布 | packages/dsh-pet/test/locus-composition.test.ts | `隔离能力无法证明时不发布` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | safe-v1 行继续服务 | packages/dsh-pet/test/locus-composition.test.ts | `safe-v1 行继续服务` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 主会话 preset 不影响子会话工具面 | packages/dsh-pet/test/locus-composition.test.ts | `主会话 preset 不影响子会话工具面` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 冷恢复不回落到父组合 | packages/dsh-pet/test/locus-composition.test.ts | `冷恢复不回落到父组合` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 升级前的 legacy child 不可恢复服务 | packages/dsh-pet/test/locus-composition.test.ts | `升级前的 legacy child 不可恢复服务` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 普通资料发布 | 既有测试（实施时定位） | `普通资料发布` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 决策往返 | 既有测试（实施时定位） | `决策往返` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 多人连续提问 | 既有测试（实施时定位） | `多人连续提问` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 父回复与下一条飞书消息不会合批 | 既有测试（实施时定位） | `父回复与下一条飞书消息不会合批` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 超时不重建会话 | 既有测试（实施时定位） | `超时不重建会话` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 长父历史不能冒充子身份 | 既有测试（实施时定位） | `长父历史不能冒充子身份` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 业务完成只经统一工具提交 | 既有测试（实施时定位） | `业务完成只经统一工具提交` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 无法证明独立能力时拒绝创建 | 既有测试（实施时定位） | `无法证明独立能力时拒绝创建` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 历史不含最新目录 | 既有测试（实施时定位） | `历史不含最新目录` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 主会话无法回答 | 既有测试（实施时定位） | `主会话无法回答` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 跨 turn 父回复继续 current Delivery | 既有测试（实施时定位） | `跨 turn 父回复继续 current Delivery` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 单独的 agent 消息不能获得飞书能力 | 既有测试（实施时定位） | `单独的 agent 消息不能获得飞书能力` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | GUI 流量仍不能消费 current | 既有测试（实施时定位） | `GUI 流量仍不能消费 current` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 新话题上下文 | 既有测试（实施时定位） | `新话题上下文` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 子会话发现不自动成为主会话认知 | packages/dsh-pet/test/locus-child-context.test.ts | `子会话发现不自动成为主会话认知` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 用户主动查阅受实际能力约束 | 既有测试（实施时定位） | `用户主动查阅受实际能力约束` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 冷恢复保留独立历史 | 既有测试（实施时定位） | `冷恢复保留独立历史` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 旧 fork child 不受影响 | packages/dsh-pet/test/locus-child-context.test.ts | `旧 fork child 不受影响` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 授予 shell 档 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | `授予 shell 档` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 撤回 shell 档 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | `撤回 shell 档` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 忙时拒绝 | 既有测试（实施时定位） | `忙时拒绝` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 核验失败回到 safe | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | `核验失败回到 safe` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | safe-v1 入口请求 shell | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | `safe-v1 入口请求 shell` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | shell 档拒绝普通成员 | 既有测试（实施时定位） | `shell 档拒绝普通成员` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 切换前排队的普通成员请求 | 既有测试（实施时定位） | `切换前排队的普通成员请求` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 冷恢复保持档位 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | `冷恢复保持档位` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 重建不继承 shell | 既有测试（实施时定位） | `重建不继承 shell` | 🟢 existing |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 非 allowlist 档位命令 | 既有测试（实施时定位） | `非 allowlist 档位命令` | 🟢 existing |
| specs/pet-locus-intent-triage/spec.md → 协作空间由干活主会话与 locus 主会话两个普通成员组成 | 建空间并邀请干活主会话 | packages/dsh-pet/test/collab-space-members.test.ts | `建空间并邀请干活主会话` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 协作空间由干活主会话与 locus 主会话两个普通成员组成 | 子会话没有协作工具 | packages/dsh-pet/test/collab-space-members.test.ts | `子会话没有协作工具` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 协作空间由干活主会话与 locus 主会话两个普通成员组成 | 干活主会话不可邀请时不建入口 | packages/dsh-pet/test/collab-space-members.test.ts | `干活主会话不可邀请时不建入口` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办由 Host 以 locus 主会话身份代写 | 代写条目的作者与附加数据 | packages/dsh-pet/test/collab-todo-actas.test.ts | `代写条目的作者与附加数据` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办由 Host 以 locus 主会话身份代写 | 工具不接受目标参数 | packages/dsh-pet/test/collab-todo-actas.test.ts | `工具不接受目标参数` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办由 Host 以 locus 主会话身份代写 | 无唯一 current 时拒绝 | packages/dsh-pet/test/collab-todo-actas.test.ts | `无唯一 current 时拒绝` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办由 Host 以 locus 主会话身份代写 | 更换 locus 主会话后待办仍在 | packages/dsh-pet/test/collab-todo-actas.test.ts | `更换 locus 主会话后待办仍在` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 所有者处置待办经 manager 代为记账 | 所有者直接了结 | packages/dsh-pet/test/collab-todo-dispose.test.ts | `所有者直接了结` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 所有者处置待办经 manager 代为记账 | 干活主会话自行完成 | packages/dsh-pet/test/collab-todo-dispose.test.ts | `干活主会话自行完成` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记后的回复如实且登记失败反馈可执行 | 登记后回复与待办状态一致 | packages/dsh-pet/test/ledger-track-feedback.test.ts | `登记后回复与待办状态一致` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记后的回复如实且登记失败反馈可执行 | 未确认路径不作为事实 | packages/dsh-pet/test/ledger-track-feedback.test.ts | `未确认路径不作为事实` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记后的回复如实且登记失败反馈可执行 | 登记失败给出操作特定指引 | packages/dsh-pet/test/ledger-track-feedback.test.ts | `登记失败给出操作特定指引` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办登记后的回复如实且登记失败反馈可执行 | 待办进度不可读与没有待办可区分 | packages/dsh-pet/test/ledger-track-feedback.test.ts | `待办进度不可读与没有待办可区分` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 登记后队列继续前进 | 既有测试（实施时定位） | `登记后队列继续前进` | 🟢 existing |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 回复完成不等于事情做完 | 既有测试（实施时定位） | `回复完成不等于事情做完` | 🟢 existing |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 待办状态变化不外发 | 既有测试（实施时定位） | `待办状态变化不外发` | 🟢 existing |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 子会话不能推进待办状态 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `子会话不能推进待办状态` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 主会话做完后自行标记完成 | packages/dsh-pet/test/collab-todo-lifecycle.test.ts | `主会话做完后自行标记完成` | 🟢 green |
| specs/pet-locus-intent-triage/spec.md → 待办生命周期与 Delivery 结算解耦 | 不经受理直接了结 | 既有测试（实施时定位） | `不经受理直接了结` | 🟢 existing |

| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首条图片不支持时安全降为文本 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | `首条图片不支持时安全降为文本` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图降级交接使用新快照 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | `首图降级交接使用新快照` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图补偿失败保留恢复债务 | packages/dsh-pet/test/locus-first-delivery-publication.test.ts | `首图补偿失败保留恢复债务` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图降级跨崩溃最多一次文本 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | `首图降级跨崩溃最多一次文本` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 已接受或认领的图片拒绝不重放 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | `已接受或认领的图片拒绝不重放` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首工具等待持久绑定 | packages/dsh-pet/test/locus-host-wiring.test.ts | `首工具等待持久绑定` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首轮持久绑定失败拒绝执行 | packages/dsh-pet/test/locus-host-wiring.test.ts | `首轮持久绑定失败拒绝执行` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 业务结算后下一条仍为独立轮次 | packages/dsh-pet/test/locus-official-queue-turn.test.ts | `业务结算后下一条仍为独立轮次` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 启动恢复证据经官方冷读获取 | 不可区分中断保持等待 | packages/dsh-pet/test/locus-startup-cold-read.test.ts | `不可区分中断保持等待` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 启动恢复证据经官方冷读获取 | 真实中断立即结算推进 | packages/dsh-pet/test/locus-startup-cold-read.test.ts | `真实中断立即结算推进` | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 启动恢复证据经官方冷读获取 | live 中断不剔除 | packages/dsh-pet/test/locus-startup-cold-read.test.ts | `live 中断不剔除` | 🟢 green |

## Coverage Notes

- 共 115 个场景全部映射：新增或改写 75 个（🔴），沿用未改 40 个（🟢 existing）。`pet-inquiry-runtime-channel` 为整体 REMOVED，无场景；其退役以 `npm test` 中 inquiry 测试被删除、工具面断言不含 `pet_inquire`/`pet_inquiry_answer` 覆盖（见 tasks）。4 个补丁的退役没有 spec 场景，由 tasks 26.3 的构建产物检查（不再替换相关官方包、无 `supportsFinalToolGuardRecheck`、无 managed-effect 标记）与 compat 包测试把关；退役最终守卫重判导致的读取时间窗是所有者接受的风险（design Risks），不设"工具体不执行"的回归测试，改由 tasks 1.5 在实际 launcher 图上复核包装层；随补丁删除的测试（`test-packaging.cjs`、`verify-native-managed-effects.mjs` 等中的对应断言、`test/inquiry-*`）不再计入。
- 夹具：dsh-pet 现有 `test/harness.ts`（`failOnWriteNumber` 等）；新增官方 subagent 替身需能模拟 `startContinuable` 带首条 prompt、`agent/created` 回滚、名额拒绝、Host `queuePrompt` 冷恢复及用户来源独立轮次；`sessionQuery.observeSession` 替身需能返回带/不带合成 `turn/end interrupted` 的事件；dsh-collab 侧用现有集成测试夹具加 adapter `owns`。
- 运行时探针（非单测）：实施第一组任务在 rc.2 上实测"冷恢复经过 `agent/created`"与"首条 prompt 创建的顺序"（design 决策 3、6）；探针失败则停止实施、返回设计评审。
- 依赖：本 worktree 缺 dsh-pet 测试依赖，实施前需 `ws promote` 后安装依赖。
- 场景名沿用但内容已改的行按 delta 中的 THEN 断言，不按场景名字面：例如「safe-v1 行继续服务」「safe-v1 入口请求 shell」在本 change 中断言的是旧模型行**不服务**、按退休规则处理（spec「Locus 业务出站只能经受管 finish」「Locus 工具档位由所有者显式授予且不重建子会话」的 MODIFIED 版本）。

### Round7 真实接缝验收约束

首图全部具名场景通过同一条真实接缝验证：`locus-first-image-fallback.test.ts` 组合真实 lazy creator、publication、持久 LocusRepository 与 channel controller，官方契约替身保留失败 child 的持久 ID 并模拟 materialize 后/submit 前结构化拒绝。断言 old bridge/WAL/current 执行预留退出，新快照与新 execution 只投原 Delivery，一并核验 deadline/FIFO/backlog、补偿失败及提交附近重启。已发出的 execution/inbox/turn 证据不得覆盖；不能以各模块独立 mock 或静态文本匹配替代该接缝。`locus-host-wiring.test.ts` 另经实际 index、真实 Cordis Tools.execute/pre-execute 做 deferred/rejected durable bind，`locus-official-queue-turn.test.ts` 使用官方 AgentLoop/Subagent 与 JSONL 验证 queue/user 与父 sendMessage 的不同轮次行为。

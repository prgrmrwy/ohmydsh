# worktree-open-handler-registry Specification

## Purpose

定义 Worktree Session 暴露的打开行为运行时注册点：同页面插件可替换分支名的打开行为，注册点不成为加载期依赖，注册方缺失或异常时安全回落到默认 deep link。

## Requirements

### Requirement: Worktree Session 暴露打开行为注册点
Worktree Session SHALL 提供一个运行时注册点，允许同页面其它插件替换「打开 worktree 目录」的实现。该注册点的命名与契约 SHALL 由 Worktree Session 自身拥有。

该注册点 MUST NOT 引用、命名或以任何方式假设特定注册方的存在。Worktree Session MUST NOT 依赖任何注册方 package。

注册契约 SHALL 为：接收一个绝对路径，执行打开动作。注册方 MUST NOT 经该契约向 Worktree Session 返回需要其解释的业务数据。

#### Scenario: 无注册方时使用默认实现
- **WHEN** 没有任何插件注册打开行为，用户触发打开
- **THEN** Worktree Session SHALL 使用其默认实现，行为与本 change 之前完全一致

#### Scenario: 存在注册方时优先使用
- **WHEN** 某个插件已注册打开行为，用户触发打开
- **THEN** Worktree Session SHALL 把绝对路径交给已注册的实现，MUST NOT 同时执行默认实现

#### Scenario: 注册点不引用具体注册方
- **WHEN** 审阅 Worktree Session 的源码与依赖声明
- **THEN** 其中 MUST NOT 出现任何具体注册方的 package 名、服务名或产品名

### Requirement: 注册点不得成为加载期依赖
Worktree Session SHALL 在没有任何注册方的部署中正常加载并完整工作。注册能力 MUST NOT 出现在其 `inject` 声明中。

依据：DSH 的 loader 在依赖不可解析时使插件**静默不加载**（而非报错降级），因此把可选协作方写入 `inject` 会导致功能无声消失。

#### Scenario: 无注册方部署正常加载
- **WHEN** 部署中不存在任何注册方插件
- **THEN** Worktree Session SHALL 完整加载，全部既有功能可用

#### Scenario: 注册能力不在 inject 中
- **WHEN** 审阅 Worktree Session 的 `inject` 声明
- **THEN** 其中 MUST NOT 含注册相关的可选服务名

### Requirement: 注册方异常时安全降级
当已注册的打开行为抛出异常、拒绝或未能完成时，Worktree Session SHALL 回落到其默认实现，且 MUST NOT 向用户报告成功。

注册方的异常 MUST NOT 传播为未捕获错误，MUST NOT 影响 Worktree Session 其余功能或宿主页面。

#### Scenario: 注册方抛错
- **WHEN** 已注册的打开行为在执行时抛出异常
- **THEN** Worktree Session SHALL 回落到默认实现，且不报告成功

#### Scenario: 注册方异常不扩散
- **WHEN** 注册方在执行中产生任何异常
- **THEN** 该异常 SHALL 被捕获；Worktree Session 的分支名控件、绑定状态与其余控件保持可用

#### Scenario: 注册方卸载后恢复默认
- **WHEN** 注册方插件被卸载或其所属 fiber 被销毁
- **THEN** Worktree Session SHALL 恢复使用默认实现，MUST NOT 持有已失效的引用

### Requirement: 注册时序不约束注册方加载顺序
注册方 MAY 在 Worktree Session 之后加载。系统 SHALL 保证后注册的实现对**后续**的打开动作生效，MUST NOT 要求注册方先于 Worktree Session 完成加载。

#### Scenario: 注册方晚于 Worktree Session 加载
- **WHEN** Worktree Session 已完成加载后，注册方才完成加载并注册
- **THEN** 此后触发的打开动作 SHALL 使用已注册的实现

#### Scenario: 注册前触发的打开
- **WHEN** 在任何注册发生之前用户触发打开
- **THEN** 系统 SHALL 使用默认实现，MUST NOT 阻塞等待可能到来的注册

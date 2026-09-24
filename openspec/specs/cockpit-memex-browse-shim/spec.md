## Purpose

把 dsh-memex 的浏览地址注册点与驾驶舱侧的端口发布能力接起来，使跨机器部署下卡片浏览可达；它是本仓唯一知道这两者同时存在的地方，移除它即解除耦合，两端均无需改动。

## Requirements

### Requirement: shim 是唯一耦合点，两端互不知晓

本 package SHALL 是本仓唯一同时引用「记忆卡片浏览」与「驾驶舱端口发布」两端的地方。两端 MUST NOT 互相引用对方的 package 名、服务名或产品名，也 MUST NOT 依赖本 package。

移除本 package SHALL 足以解除两端耦合，且 MUST NOT 要求修改任何一端。

#### Scenario: 两端源码互不提及
- **WHEN** 审阅两端插件的源码与依赖声明
- **THEN** 其中 MUST NOT 出现对方的 package 名或服务名，也不出现本 shim 的名字

#### Scenario: 移除 shim 即解耦
- **WHEN** 从部署中移除本 package
- **THEN** 两端各自完整加载并正常工作，记忆卡片浏览回落为本机地址行为，无需修改任一端

### Requirement: 两端缺任一方即整体不生效，且不影响任一方加载

本 package SHALL 在运行时探测两端。任一端缺席时，本 package SHALL 不产生任何效果，MUST NOT 抛出未捕获错误，MUST NOT 阻碍任一端加载或工作。

本 package MUST NOT 声明任何顶层 `inject`：两端均为可选，而 DSH 的 loader 在依赖不可解析时使插件**静默不加载**，声明 inject 会让本 package 在最需要降级的部署里直接消失。

两端 MAY 以任意顺序加载；本 package SHALL 在两端都就绪后完成接线，并在任一端消失时解除接线。

#### Scenario: 仅安装记忆插件
- **WHEN** 部署中没有驾驶舱桥接能力
- **THEN** 本 package 不产生效果，记忆卡片浏览使用其默认的本机地址实现

#### Scenario: 仅安装驾驶舱桥接
- **WHEN** 部署中没有记忆卡片浏览的注册点
- **THEN** 本 package 不产生效果，桥接插件其余功能不受影响

#### Scenario: 任一端后加载
- **WHEN** 两端中较晚的一个完成加载
- **THEN** 本 package 此时完成接线，此后触发的打开动作走已接线的实现

#### Scenario: 一端卸载后解除接线
- **WHEN** 已接线后其中一端被卸载或其 fiber 被销毁
- **THEN** 本 package 解除接线且不持有失效引用，记忆侧恢复其默认实现

### Requirement: shim 最薄——只探测与转接

本 package SHALL 只做探测两端、转接请求、注册与注销。它 MUST NOT 校验地址、MUST NOT 拼装或改写地址、MUST NOT 重试、MUST NOT 持有业务状态、MUST NOT 缓存已交付的地址。

依据：耦合点承载的逻辑越多，解耦成本越高。地址的产出与校验属于驾驶舱侧职责（它持有转发事实），降级属于记忆侧职责（它有默认实现）。

#### Scenario: 不承载业务逻辑
- **WHEN** 审阅本 package 的实现
- **THEN** 其中不含地址校验、拼装、重试或状态缓存逻辑

#### Scenario: 失败原样上抛
- **WHEN** 驾驶舱侧能力在转接过程中失败
- **THEN** 本 package 不吞掉也不改写该失败，由记忆侧按其规范呈现原因

### Requirement: 跨插件服务读取使用完整 dotted name 的单次读取

本 package 读取任一端的服务时 SHALL 使用完整 dotted name 的单次 inject-free 读取（形如 `ctx.get('a.b')`），MUST NOT 先读父服务再取子属性（形如 `ctx.get('a').b`）。

依据：Cordis 会把注册为 `<service>.<name>` 的点属性重新路由回 context proxy，而 context proxy 强制 `inject`，使这个本应可降级的可选接缝抛出未捕获错误。该失败已在本仓实测记录。

#### Scenario: 以完整名读取
- **WHEN** 审阅本 package 对两端服务的读取方式
- **THEN** 每次读取都使用完整 dotted name 的单次调用，不出现先取父服务再访问子属性的写法

#### Scenario: 缺席读取不抛错
- **WHEN** 某端服务尚未注册时本 package 读取它
- **THEN** 读取返回空值而非抛出未捕获错误，本 package 据此保持未接线

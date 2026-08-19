# subscriptions-sandbox-shim Specification

## Purpose

在订阅 provider(默认 ChatGPT/Codex、Grok)的 LLM 工具面上清洗 sandbox 升级字段(`sandbox_permissions`/`justification`):出站从工具 schema 剥离以消除模型误填诱因,入站从工具调用参数剥离以硬保证调用成功,且对非目标 provider 零影响。是 DSH core 缺陷(静态 schema 广告 vs 执行期严格更宽检查)的部署侧缓解,不改 DSH 源码、不改订阅插件本体。

## Requirements

### Requirement: 出站工具 schema 剥离

对配置内目标 provider 的每次 LLM 请求,系统 SHALL 从发送给模型的工具 `parameters` 中移除 `sandbox_permissions` 与 `justification` 两个属性;工具 schema 原本不含这两个属性时,请求 SHALL 不被修改;非目标 provider 的请求 SHALL 原样透传。

#### Scenario: 目标 provider 请求含升级字段的 schema
- **WHEN** 目标 provider(如 codex)的一次请求携带含 `sandbox_permissions`/`justification` 的工具 schema
- **THEN** 模型实际收到的 schema 中这两个属性不存在,其余 schema 内容不变

#### Scenario: 目标 provider 请求已无升级字段
- **WHEN** 目标 provider 的一次请求的工具 schema 本就不含这两个属性
- **THEN** 请求对象不被替换或改写,按原样转发

#### Scenario: 非目标 provider 透传
- **WHEN** 非目标 provider(如 deepseek)的一次请求携带含这两个属性的工具 schema
- **THEN** 请求按原样转发,schema 不被修改

### Requirement: 入站工具调用参数剥离

对配置内目标 provider 返回的流,系统 SHALL 在工具调用块收口时,从 `arguments` JSON 中移除 `sandbox_permissions` 与 `justification` 两个键;`arguments` 无法按 JSON 解析时 SHALL 原样透传;非目标 provider 的流 SHALL 逐 chunk 原样透传。

#### Scenario: 工具调用参数含升级字段
- **WHEN** 目标 provider 返回的工具调用 `arguments` 为合法 JSON 且含这两个键
- **THEN** 工具实际执行收到的 `arguments` 不含这两个键,其余键值不变

#### Scenario: 工具调用参数非法 JSON
- **WHEN** 目标 provider 返回的工具调用 `arguments` 无法解析为 JSON
- **THEN** 参数按原样交付执行,不报错、不丢弃

#### Scenario: 非目标 provider 流透传
- **WHEN** 非目标 provider 返回的流中包含任意 chunk(含工具调用块)
- **THEN** 每个 chunk 按原样交付,不做任何改写

### Requirement: 作用范围可配置

系统 SHALL 通过插件配置声明作用 provider 列表(默认 `codex`、`grok`),并分别提供出站剥离与入站剥离的开关(默认均开启)。

#### Scenario: 默认配置
- **WHEN** 未显式配置且 codex/grok 已注册为 provider
- **THEN** 仅 codex 与 grok 的请求/流受剥离影响,其他 provider 不受影响

#### Scenario: 仅入站剥离
- **WHEN** 配置关闭出站剥离开关、保留入站剥离开关
- **THEN** 模型仍能看到两个 schema 属性,但工具调用参数仍被清洗

### Requirement: 会话历史一致性与恢复

清洗后的工具调用参数 SHALL 进入会话持久化历史;会话恢复(resume)后派生消息中的工具调用参数 SHALL 仍为清洗后的值,不复活原始参数。

#### Scenario: 会话恢复
- **WHEN** 一个含清洗后工具调用参数的会话被恢复并继续
- **THEN** 派生历史中的该工具调用参数不含这两个键

### Requirement: 重复包装防护

同一适配器实例 SHALL 至多被包装一次;适配器注册/替换事件多次触发不得产生叠加包装。

#### Scenario: 注册事件多次触发
- **WHEN** 同一适配器实例的注册或替换事件被多次观察到
- **THEN** 该适配器的包装仍为单层,行为与包装一次一致

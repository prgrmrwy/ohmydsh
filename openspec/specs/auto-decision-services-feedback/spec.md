# auto-decision-services-feedback Specification

## Purpose
允许 AUTO 在多个决策服务间显式选择且凭据互不混用，并把各维度置信度、分布、耗时与应用状态如实展示给用户，缺失值不编造。

## Requirements

### Requirement: 服务与凭据隔离
系统 SHALL 默认沿用OpenRouter，允许选择TypeSafe、Concentrate及兼容自定义完整endpoint；凭据 SHALL 分服务存储并每次调用按配置快照解析，MUST NOT 自动回退或混用key。endpoint SHALL 限HTTPS或回环HTTP，无URL凭据/query/hash，禁止重定向。
#### Scenario: 切换服务
- **WHEN** 用户保存TypeSafe服务选择
- **THEN** 下次判定使用其固定endpoint与key引用，旧OpenRouter key不发送给新服务

### Requirement: 决策可感知
系统 SHALL 保留并展示独立维度置信度、耗时、服务模型和推荐/应用状态；未返回值 SHALL 显示未提供，MUST NOT 编造置信度或将其表示为任务成功率。tooltip SHALL 不受toast开关影响。
#### Scenario: 双维判断
- **WHEN** 子任务返回能力与深度以及不同置信度
- **THEN** 分别呈现两维结果，只有实际请求配置匹配后才报告已应用

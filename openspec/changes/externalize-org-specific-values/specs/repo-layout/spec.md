## ADDED Requirements

### Requirement: 公开仓库不硬编码组织专属值

公开仓库的源码、manifest、规范与文档 SHALL NOT 包含组织专属的域名、包源地址、内部工具名或员工标识。需要这类值的能力 SHALL 以通用逻辑实现，并通过插件行 `config` 等部署配置接收具体值；具体值 SHALL 由私有 overlay 提供（例如一个按行 id 覆盖插件行的 patch）。只对单一组织有意义的整项能力 SHALL 整体放在私有 overlay 中。示例值 SHALL 使用 `*.example` 等保留域名。

#### Scenario: 组织域名经 overlay 注入
- **WHEN** 某插件需要识别组织的代码托管 host
- **THEN** 公开源码只读取插件行 `config`,真实 host 写在私有 overlay 的 patch 中

#### Scenario: 组织专属能力整体私有
- **WHEN** 某 skill 依赖只有该组织才有的内部 CLI
- **THEN** 该 skill、其 manifest 条目与规范都放在私有 overlay,公开仓库不留痕迹

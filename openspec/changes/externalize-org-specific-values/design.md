## Context

私有 overlay 能追加整条定制（package、patch、skill），但不能改公开包内部的常量。DSH 的 profile patch 支持按行 id 覆盖某个插件行，被覆盖的字段整体替换，`config` 不做深合并；插件的 `apply(ctx, config)` 会收到该行的 `config`。

用户选定的方向：内部值改成配置，真值挪进私有仓库，功能不丢（2026-09-30）。

## Goals / Non-Goals

**Goals**
- 公开源码与规范不出现组织专属域名、包源、内部工具名。
- 接了 overlay 的机器上，守门、scope 派生、链接分类、send-cr 的行为与改动前一致。
- 未接 overlay 时行为明确、可观察，不静默假装生效。

**Non-Goals**
- 不把这些值做成设置页可编辑项：它们决定守门输入，放宽应当是显式的手工改动（与发布方向不可在设置页编辑的既有取舍一致）。
- 不处理 git 历史（另行重写）。

## Decisions

### D1 用插件行 `config`，不用 live settings

值由私有 overlay 的 patch 注入，公开仓库零痕迹。live settings 存在 `~/.dsh/settings.yaml`，需要人手工维护，且设置页可能暴露编辑入口。行 config 在 DSH 重启时生效，这类值本就极少变化。

### D2 按行 id 覆盖，整份 config 以 overlay 为准

overlay patch 形如 `- id: dsh-memex / name: dsh-memex / config: {...}`。由于 config 不深合并，overlay 必须给出该行完整的 config。两个插件目前没有其它行 config，因此不会丢配置；overlay patch 的注释写明这一约束。

用户层 `cordis.patch.yml` 在全部 bundle 层之后应用，所以覆盖一定落在包自带插入行之后。

### D3 未配置 = 规则无输入，显式报告

与 `structural:workspace-path-rule-inactive` 同一原则：缺输入的规则不拦也不放过，而是报告。新增 `structural:internal-host-rule-inactive` 进入写入结果的 `guardWarnings` 与运行日志。

### D4 非法条目丢弃并记录

host 名按 RFC 形态校验、小写化、去首尾点、去重。非法条目丢弃，写一条 warn 日志；不猜、不部分匹配。

### D5 链接分类：公开默认只认公开平台，规则随基线下发

浏览器端插件拿不到行 config，而 host 端能拿到。host 在全量基线响应中附带 `rules`，浏览器端对 `rules` 再做一次校验（线上数据不直接信任），然后采用这份规则，并重分类已采集的链接，保证两端一致。在基线到达之前的短暂窗口内使用公开默认。

### D6 send-cr 整体迁出

它依赖组织内部 CLI，对公开仓库的使用者无意义；改成可配置 CLI 反而要在公开仓库保留一份只对单一组织成立的流程。整体迁入私有仓库：skill、manifest 条目，以及规范（放在私有仓库 `docs/specs/`）。Pet 中以 `send-cr` 为例的测试只把它当作任意 skill 名，保持不变。

## Risks / Trade-offs

- 公开行将来如果加了 config，overlay 的整行覆盖会把它盖掉。缓解：overlay patch 注释写明；审查公开行变更时一并检查。
- 未接 overlay 的机器上，写入外部库的卡片中出现组织域名将不再被拦截，只会报告。这是公开默认必须接受的代价：公开源码无从知道哪些域名是内部的。

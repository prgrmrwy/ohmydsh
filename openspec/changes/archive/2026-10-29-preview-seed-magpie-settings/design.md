## Context

`SEED_FILES` 是 prepare-preview 原样复制文件的单一白名单，复制逻辑已处理缺失跳过、拒绝链接与 0600 权限。connector 的 `settings.json` 只存线路、可见模型、默认 effort 与 `knownOwners`；按其 README，key 与 Access 值不写入该文件。

## Decisions

- 直接加入 `SEED_FILES`，复用现有逐字复制路径，不做字段过滤：文件里没有凭据，过滤只会让副本与真实 home 不一致。
- 预览中 connector 写回的 `knownOwners` 只影响隔离 home；下次 prepare-preview 会用真实 home 的内容覆盖，与其它受管项一致。

## Risks / Trade-offs

- [connector 将来把凭据写进 settings.json] → 升级 connector 时复核 README 的"keys … are never written there"一句；若不再成立，从白名单移除。

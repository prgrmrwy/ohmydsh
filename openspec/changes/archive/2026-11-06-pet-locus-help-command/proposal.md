## Why

入口的控制命令（`/bind`、`/unbind`、`/access` 及其短写）越来越多，群成员和所有者没有办法在聊天里查看当前支持什么。所有者希望 `@bot -h` 就能看到可用命令与参数。

## What Changes

- 新增控制命令 `-h` / `--help` / `/help`：回复一条控制回执，列出当前可用命令、参数形式与一句话说明。
- 回执文本由唯一的命令表生成，解析器识别命令也使用同一张表，帮助内容不会与实际可用命令漂移。
- 已弃用的 `/scope`、`/tools` 不列出。
- 帮助是纯控制命令：不建入口、不建子会话、不产生业务 Delivery；在已停止（retired）的入口上同样可用。
- 帮助与其他控制命令一样仅 allowlist 发送者可用（沿用既有“控制命令只对 allowlist 开放”的准入规则）。

## Capabilities

### Modified Capabilities

- `pet-locus-collaboration`: 新增“控制命令帮助”需求。

## Impact

- `packages/dsh-pet/src/host/locus/admission.ts`（命令表与解析）、`control.ts`（回执）、对应测试。

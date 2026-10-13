# Proposal

## Why

Pet 媒体下载把官方 `lark-cli` 锁死在精确版本 `1.0.94`：用户升级到 1.0.97 后，下次 Host 重启时 media port 即变为 unavailable，群里的图片只能降级为纯文字。每次 lark-cli 发版都要改代码、改规范才能恢复，而 Pet 真正承重的隔离（独占 0700 cwd、写入期尺寸轮询、receipt 校验、无条件递归删除、child read guard 拒绝 spool）与 CLI 版本无关。同时现行规范写着"由 Pet 私有解析，绝不回退 PATH"，实现却一直用 PATH 上的 `lark-cli`，与订阅、身份、出站等全部 Pet 调用一致——规范与实现已不一致。

## What Changes

- 媒体下载的版本门从"等于 pin `1.0.94`"改为"不低于已审查下限 `1.0.97`"；更高版本自动放行，无需改代码。
- **BREAKING（行为面）**：低于 1.0.97 的 lark-cli（含此前唯一放行的 1.0.94）不再获得媒体能力，降级为纯文字，并在日志中给出"需要 ≥1.0.97"的诊断。
- 媒体下载使用与 Pet 其它 lark-cli 调用相同的解析方式（PATH 上的 `lark-cli`），规范删除"私有解析、绝不回退 PATH"的表述，改为"与 Pet 其它调用同一 binary"。
- 现有的 spool 隔离与有界下载不变量保持不变，并明确它们是不依赖 CLI 版本的承重层。
- 更新 `dsh.yaml` note 与 `packages/dsh-pet/docs/media-download.md` 中的版本说明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-media-access`: "当前 Delivery 的图片由 Host caller-bound 取得"的 CLI 可用性条件从精确 pin + 私有解析改为版本下限 + 与 Pet 其它调用同一 binary。

## Impact

- 代码：`packages/dsh-pet/src/host/channel/lark-cli-compat.ts`（版本比较）、`packages/dsh-pet/src/host/channel/media.ts`（`PinnedLarkDownloader.pinnedVersion` 字面量类型与 `'1.0.94'` 硬比较）。
- 测试：`packages/dsh-pet/test/lark-cli-compat.test.ts`、`packages/dsh-pet/test/locus-media.test.ts`。
- 文档/manifest：`dsh.yaml` dsh-pet note、`packages/dsh-pet/docs/media-download.md`。
- 运行环境：本机 PATH 上首个 `lark-cli` 为 1.0.97（`~/.nvm/.../bin`），`/usr/bin/lark-cli` 仍为 1.0.94；改后 Host 重启即恢复媒体。
- 不涉及：bot 身份最低版本（`pet-lark-channel`，已是下限语义，最低已验证 1.0.93）、订阅与出站路径、云文档评论事件（另行 change）。

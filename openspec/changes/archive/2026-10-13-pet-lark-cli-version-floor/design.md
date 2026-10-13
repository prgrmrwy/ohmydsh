# Design

## Context

见 proposal.md - Why。现状：`resolvePetLarkCliCompat`（`packages/dsh-pet/src/host/channel/lark-cli-compat.ts:82`）要求 `version === '1.0.94'`；`media.ts:73` 把 `pinnedVersion` 类型写成字面量 `'1.0.94'`，`media.ts:352` 再做一次硬比较。binary 默认取 PATH 上的 `lark-cli`（`lark-cli-compat.ts:65`），与 `cli.ts` 中 Pet 其它调用一致。

隔离承重层（`docs/media-download.md` 已记录，测试已钉住）：每次调用独占 0700 子目录作 cwd + 相对 `--output`；50 ms 轮询尺寸、超限杀进程组；receipt `saved_path` basename 与 `size_bytes` 校验；成功/失败/取消一律递归删除；启动清扫；spool 位于 child `deniedRoots` 内。

## Goals / Non-Goals

**Goals:** 版本门改为下限；新版本免改代码；规范与 PATH 解析的实际行为对齐。

**Non-Goals:** 不改下载流程本身；不改 bot 身份版本门（`pet-lark-channel` 已是下限语义）；不处理云文档评论事件；不引入 Pet 私有 binary 解析。

## Decisions

1. **下限 `1.0.97`，而非继续 1.0.94。** 1.0.97 是本机当前版本，且将在本 change 的真机验收中重新跑通媒体链路；1.0.94 不再被验收，故不保留。备选"下限 1.0.94"会放行一个此后不再测试的版本组合，否决。
2. **语义化三段比较，只认 `\d+.\d+.\d+`。** 复用现有 `VERSION_PATTERN`，逐段数值比较；带预发布后缀的版本只取主三段（与现有解析一致）。不引入 semver 依赖——三段数值比较足够且无新信任面。
3. **类型从字面量改为 `string`，字段改名 `version`。** `PinnedLarkDownloader` → `VerifiedLarkDownloader`，`pinnedVersion: '1.0.94'` → `version: string`，常量 `PET_LARK_CLI_PINNED_VERSION` → `PET_LARK_CLI_MIN_VERSION`。`createLocusMediaPort` 的二次检查改为调用同一 `meetsPetLarkCliFloor(version)`，避免两处各自比较而漂移。
4. **继续用 PATH 上的 `lark-cli`，修规范而非修实现。** 用户决定。理由：媒体与订阅/出站共用同一 binary，用户升级一次全部生效；分开解析会出现"订阅用 A、媒体用 B"的不可见分歧。

## Risks / Trade-offs

- [未来版本改变 `--output` 允许根或原子写行为，使下载落到 spool 外] → 相对路径 + cwd 由 Pet 决定、receipt `saved_path` basename 校验与尺寸轮询仍在；若 CLI 拒绝相对路径或写到别处，receipt 校验失败、按现有路径删除并降级。真机验收覆盖 1.0.97。
- [未来版本 receipt 字段变化] → 现有解析失败即 fail closed 为 unavailable/拒绝，不产生 attachment。
- [PATH 上的 lark-cli 被替换为非官方 binary] → 与 Pet 订阅/出站同一信任面，本 change 不扩大；已在 pet-lark-channel 的信任边界内。

## Migration Plan

改代码 → 包内测试/typecheck → `dsh build` → 用户重启 DSH → 群里发图验收。回滚：revert 本 change 并 `dsh build`。

## Why

`scripts/bootstrap.sh` 此前用**精确相等**判断工具链版本(`node -v` 必须等于 `24.12.0`、`npm -v` 必须等于 `11.6.2`),任何 patch 级差异都会让全新 checkout 的初始化直接 `exit 1`。实际使用中(node v24.16.0 / npm 11.13.0)即被误判为「版本不匹配」而无法 bootstrap——门槛卡的是**可复现性无关的版本抖动**,而不是真正跑不起来的环境。仓库依赖的可复现性由根 `package-lock.json` 保证,不需要再由精确版本相等来兜底。

## What Changes

- bootstrap 的工具链校验从「精确相等」改为「最低版本准则」:低于最低版本才拒绝初始化,高于最低版本一律放行。
- 最低版本定为 **node >= 22.0.0 / npm >= 10.0.0**;`.nvmrc` 中的版本降级为**推荐值**,当前版本与推荐值不同时只打印提示,不阻塞。
- bootstrap 内置纯 bash 的版本比较(逐段数值比较,容忍前导零、缺省段与预发布后缀),不依赖 `sort -V` 或 semver,保持 macOS / Linux / WSL / Git Bash 通用。
- 根 `package.json` 的 `engines` 从精确版本改为范围(`>=22.0.0` / `>=10.0.0`),与 `.npmrc` 的 `engine-strict=true` 配合成为同一套准则;移除 `packageManager: "npm@11.6.2"`,避免 corepack 在 engines 之外再硬锁一次精确 npm。
- README「从零开始」的前置要求同步改为最低版本表述。
- 非 **BREAKING**:原先能通过校验的环境(精确命中推荐版本)在新准则下仍然通过。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `repo-layout`: 新增一条要求,规定仓库初始化的 Node/npm 工具链校验采用最低版本准则,并明确 `.nvmrc` 为推荐值而非强制值;与既有「仓库依赖锁采用根级单一来源」要求共同界定可复现性的来源。

## Impact

- `scripts/bootstrap.sh`:版本检查段落与 `version_lt` 比较函数。
- `package.json`:`engines` 范围化,移除 `packageManager`。
- `package-lock.json`:root 条目的 `engines` 同步(仅此两行)。
- `README.md`:前置要求表述。
- `.nvmrc` / `.npmrc` 保持不变:前者继续作为推荐版本的单一来源被 bootstrap 读取,后者的 `engine-strict=true` 继续生效,只是校验对象变成范围。
- 无运行时影响:不涉及 `dsh.yaml`、sync 物化流程或任何 package 行为。

## 1. 先立不变量与回归（红）

- [x] 1.1 在 `src/host/paths.ts` 增加 spool 路径（`stateRoot/media-spool`）与 0700 创建，纳入 `ensurePetDirectories`。
- [x] 1.2 新增回归测试：断言 spool 位于 child 守卫拒绝的 root 之内，且守卫安装后 safe child 的 `read` / `read_image` / `glob` / `grep` 对 spool 内文件一律被拒。该测试钉住的是不变量（改动前后都应通过），本 change 之后它是该属性的唯一依据。
- [x] 1.3 新增断言：`dsh.yaml` 与 `paths` 不再引用 `compat/lark-cli`（步骤 4 完成前为红，作为删除步骤的守卫）。

## 2. 下载实现改为受守卫私有目录

- [x] 2.1 改写 `src/host/channel/media.ts` 的下载：以 `cwd = spool` spawn 官方 `lark-cli`，`--output ./<32-hex>.bin`，保留 detached 进程组与现有超时/Abort 语义。
- [x] 2.2 实现写入期有界：每 50 ms 检查目标与原子写临时条目尺寸，超过本次上限立即终止整个进程组。
- [x] 2.3 实现清理：每次调用 `finally` 删除本次随机前缀的全部条目；下载完成后按文件实际尺寸做尺寸校验与消息级累计（沿用既有 `totalBytes` 语义）。
- [x] 2.4 新增启动清扫：Pet 初始化时清空 spool 全部条目，并记录一条诊断。
- [x] 2.5 单测覆盖：写入期超限终止、Abort、timeout、CLI 非零退出、receipt 尺寸不符、崩溃残留清扫、并发前缀互不删除。

## 3. 可用性判定与 wiring

- [x] 3.1 改写 `src/host/channel/lark-cli-compat.ts`：判定改为「可解析可执行 + `lark-cli --version` 等于 pin 1.0.94」，失败抛 `PetLarkCliCompatUnavailableError`；删除 provenance/patch/commit 常量与 artifact 解析。
- [x] 3.2 更新 `src/index.ts` wiring：媒体可用性判定、spool 启动清扫、失败时保持 fail-soft（日志一条、文字 Delivery 继续）。
- [x] 3.3 单测覆盖：binary 不可解析、版本不符（旧版/新版）两种情况 media port 均为 unavailable 且不写盘。

## 4. 删除 fork 与构建链

- [x] 4.1 删除 `packages/dsh-pet/compat/lark-cli/`（`build.mjs`、`bounded-fd-download.patch`、`README.md` 及生成目录）。
- [x] 4.2 `packages/dsh-pet/package.json`：`build:runtime-compat` 移除 lark-cli 段，`build` 链保持可用。
- [x] 4.3 `dsh.yaml`：移除 `buildInputs` 中三条 `compat/lark-cli/*` 登记，并在 dsh-pet note 中记录本次收窄。
- [x] 4.4 全仓检查无残留引用（`grep -rn "compat/lark-cli\|output-fd\|max-bytes\|bounded-fd" --include=*.ts --include=*.mjs --include=*.json --include=*.yaml`）。

## 5. 规范与文档

- [x] 5.1 更新 `docs/notes/` 说明本次 seam 更换的取舍、被接受的退化（无读前拒绝）与守卫成为唯一依据这一决定。
- [x] 5.2 归档前确认 `openspec/specs/pet-locus-media-access/spec.md` 已反映最终行为（REMOVED/MODIFIED/ADDED 三条 delta 合入），且 Purpose 段落不再声称私有 fork。

## 6. 验证

- [x] 6.1 运行 `npm run build`、`npm run typecheck`、`npm test`（包内）与仓库 `npm test`，全部通过。
- [x] 6.2 运行 `node scripts/sync.mjs` 两次，确认幂等且不产生可重建产物入库。
- [x] 6.3 真机验收：群内发图 → child 收到 typed image；结算后 spool 为空；child 尝试读取 spool 被拒；`lark-cli` 不可用时媒体降级为纯文本且 Delivery 继续。
- [x] 6.4 `openspec validate pet-media-official-cli-download --strict` 通过，且冷构建不再 clone 上游或下载 Go 工具链（观测 `npm run build` 输出与磁盘目录）。

# Tasks

## 1. 声明与校验（manifest / sync）

- [x] 1.1 写失败测试 `tests/host-prerequisites.test.mjs`：manifest 侧校验
  - 合法 `hostPrerequisites: [{ kind: npm-global, package, version }]` 通过且 `sync` 不安装任何东西
  - `version` 为 `^0.4.1` / `latest` / 空 → 报错并指出条目与字段
  - `kind: homebrew` → 报错，不忽略
  - 同一 manifest 两条声明同一 `(kind, package)` → 报错
  - 非 `type: package` 条目声明 → 报错
- [x] 1.2 抽出 `scripts/lib/manifest-enabled.mjs`（`ENV_BOOL_TRUE/FALSE`、`resolveEnabledOverride`、`isCustomizationEnabled`），`scripts/sync.mjs` 改为 import；`tests/sync-customization-enabled-env.test.mjs` 保持绿
- [x] 1.3 在 `scripts/sync.mjs` 实现 `hostPrerequisites` 校验（形状、精确版本、npm 包名、registry URL、重复声明），只校验不物化
- [x] 1.4 加漂移检查：`dsh.yaml` 中 `dsh-memex` 的声明版本必须等于 `packages/dsh-memex/src/tools/descriptions.generated.ts` 的 `KERNEL_VERSION`（不一致时测试失败并打印两处值）

## 2. 自愈脚本 `scripts/host-prerequisites.mjs`

- [x] 2.1 写失败测试：用假 `npm`（PATH 首位）与假全局 root 驱动真实脚本
  - 缺失 → 执行 `npm install -g @touchskyer/memex@0.4.1 --registry=…`，随后重查通过、退出码 0
  - 已健康 → 不出现 install 调用
  - 版本不符（0.4.0）→ 安装声明版本，命令中无范围/标签
  - 定制禁用 / `enabledEnv` 关闭 → 不检查不安装
  - 无任何声明 → 不 spawn npm
  - 安装失败（假 npm 退出 1）→ 退出码 1、stderr 有可操作信息、不抛栈
  - `--check` → 不改动全局 root，结果与状态一致
  - registry 优先级：条目 > `npm_config_registry` > 仓库 `.npmrc`
- [x] 2.2 实现脚本：`--check` / `--json`，`loadManifestWithOverlay` + `applyEnvLocal` + 共享 enabled 判定，`npm root -g` 探测，`runBoundedProvision` 安装（默认 180s），安装后重查

## 3. 启动器接入 `bin/dsh`

- [x] 3.1 写失败测试 `tests/launcher-host-prerequisites.test.mjs`：真实 `bin/dsh` 沙箱
  - 启动路径调用自愈；失败只警告且仍启动（探针证明 server exec 发生）
  - `DSH_SKIP_HOST_PREREQUISITES=1` → 跳过并说明
  - `dsh doctor` → 执行检查/安装并以退出码反映结果；`dsh doctor --check` 只读
- [x] 3.2 `bin/dsh`：在 autoUpdate 闸口内、`do_build` 之前调用自愈；失败写警告 + `dsh-startup.log` 事件；新增 `doctor` 子命令与 usage/文件头文案

## 4. 页面可见性（dsh-memex）

- [x] 4.1 写失败测试 `packages/dsh-memex/test/page.test.tsx`：内核不可解析时给出可读原因（含期望版本、未检测到/版本不符），健康时不出现该说明
- [x] 4.2 `src/client/locales.ts` + `src/client/page.tsx`：失败码映射为可读原因，使用同次取样的 `kernel.expected` / `kernel.version`；不加任何安装按钮

## 5. 声明与文档

- [x] 5.1 `dsh.yaml`：`dsh-memex` 条目加 `hostPrerequisites`，note 补一句自愈语义
- [x] 5.2 `packages/dsh-memex/README.md` 运行前提章节改为「启动器自动 provision；手动命令仍有效」；`docs/notes/dsh-memex-integration.md` 补一节「内核自愈与失败形态」

## 6. 验证

- [x] 6.1 `npm test`（仓库级）、`npm test -w packages/dsh-memex`、`npm run check:artifacts`
- [x] 6.2 `node scripts/sync.mjs` 连跑两次第二次 `no changes`；`dsh build` 后 profile 内 `dsh-memex` 产物含新文案
- [x] 6.3 端到端：故意移走全局内核 → `dsh doctor` 装回 → `memex_recall` 恢复；`dsh` 启动路径同样能自愈（只读检查用 `--check` 复核）

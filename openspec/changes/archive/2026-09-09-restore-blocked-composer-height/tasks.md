## 1. 兜底样式实现

- [x] 1.1 `src/client/index.ts`：在现有 `<style data-plugin="dsh-home-network-model-guard">` 的样式常量中追加 composer 兜底规则块 `[data-input-scroll] > div { min-height: 24px }`（D1/D2/D4）
- [x] 1.2 规则块内写明：这是对官方 0.1.2-rc.1 composer 回归（textarea→Lexical 迁移删除 mirror 后非 hero 态失去最小高度）的临时补偿，以及可判定的移除条件（D5）
- [x] 1.3 确认只使用 `data-*` 语义锚点，不出现任何 `uV2eYG_` 构建期哈希类名
- [x] 1.4 确认未改动判定逻辑、RPC 契约、`blocks.set` 用法与 Host 半区任何文件

## 2. 回归测试

- [x] 2.1 新增测试：断言注入的样式文本包含 `[data-input-scroll]` 选择器与 `min-height`
- [x] 2.2 新增测试：断言注入的样式文本**不包含** `uV2eYG_`（防止日后写死哈希类名）
- [x] 2.3 运行 `npm test`（package 内）确认新增用例通过且既有用例全绿

## 3. 文档与清单标注

- [x] 3.1 更新 package `README.md`：说明该兜底的存在、原因与移除条件
- [x] 3.2 更新 `dsh.yaml` 中 `home-network-model-guard` 的 note：标注为官方 0.1.2-rc.1 回归的临时补偿及移除条件

## 4. 验证与物化

- [x] 4.1 package 内运行 `npm run typecheck` 与 `npm test` 全绿（70 tests，含新增 4 例）
- [x] 4.2 仓库级运行 `npm test`（96 pass / 0 fail）与 `npm run check:artifacts`（通过）
- [x] 4.3 运行 `node scripts/sync.mjs` 物化：本包首次重建并原子重装，第二次为 `up-to-date`（幂等成立）
- [x] 4.4 确认物化后的部署产物 `~/.dsh/profiles/web/node_modules/dsh-home-network-model-guard/lib/client.js` 含该兜底规则，且不含 `uV2eYG_` 哈希类名
- [ ] 4.5 **实机验收（须在受限出口机器上完成）**：blocked + **空草稿**时输入区恢复至少一行高度、阻断原因文案可读，不再塌陷为细条
- [ ] 4.6 **实机验收（同上机器）**：blocked + **已有草稿**时草稿保持可见、高度正常、仅发送被禁用（回归保护——该路径本就正常，兜底不得破坏它）
- [ ] 4.7 **实机验收（同上机器）**：切换到非 Claude 模型后输入框恢复正常可用，兜底不影响未阻断状态的外观与交互

> 说明：本仓库当前出口判定为 `allowed`，无法本地复现 blocked 态。§2 的测试只覆盖注入文本的静态断言，**不得**以其通过冒充 4.5–4.7 的实机验收；三项须由受限出口机器上的人工确认后才可勾选。
>
> 4.2 备注：期间观察到 `tests/launcher-npm-env.test.mjs` 的「server 环境剥离 npm exec 烘焙变量」偶发失败一次（残留 `npm_node_execpath`/`npm_package_name`）。已用 stash 基线复核确认与本改动无关：清空 `npm_*` 后单跑该文件 9 pass / 0 fail，重跑整套亦 96 pass / 0 fail。该用例需 spawn 启动器（约 6.6s），对环境与时序敏感。
>
> 4.3 备注：整体 sync 以非零码结束，唯一失败项是 `failed to remove @byted/dsh-traex-bridge`（内部 bnpm 包卸载失败），与本 change 无关——`git diff dsh.yaml` 中不含 traex 相关改动。本包自身两次运行分别为「重建并原子重装」与「up-to-date」，幂等语义未受影响。

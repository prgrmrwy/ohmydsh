# Tasks

## 1. 策略与 Host

- [x] 1.1 增加精确匹配规则、有效配置与独立 policy RPC，Host 在 Geo 前判定豁免；测试覆盖配置默认/覆盖/非法值、Geo 不调用、撤销豁免与直连继续受限。

## 2. Web 与配置界面

- [x] 2.1 输入框使用 Host 策略，刷新失败保守处理、保存后立即重评估；测试覆盖两种受限 verdict、模型切换、清理自身 block 与保留外国 block。
- [x] 2.2 设置页支持豁免列表且保存完整配置，更新中英文说明；测试验证保存不丢超时参数和列表撤销。

## 3. 仓库接入

- [x] 3.1 增加显式 dsh-magpie 部署默认，删除 dsh-magpie-connect manifest 条目；测试校验 manifest/patch 与启用行为。
- [x] 3.2 同步当前规范，运行 guard 测试、双端 typecheck、build、OpenSpec strict 校验与 artifact 检查，并审查最终 diff。

## Workflow follow-up

- 用户批准后再合入任务分支、从主 checkout build 两次验证幂等；用户自行重启日常 Host，随后归档与受控清理 worktree。

# 本次验收口径修订（待独立复核）

## 用户决定

用户明确选择“记录例外，修订并复核验收口径”，并选择继续私有adapter迁移、生产暂停。此修订不改变运行时spec或测试断言，不改写过去的TDD记录，不作为通用Anvil规则修改。

## 公开实现的限定验收口径

1. 所有本change实际行为测试必须通过；不得新增skip或削弱断言。
2. 测试004/005/006/008/038/041/044/047和Node065首次运行时已由先前实现覆盖，没有自身RED见证。接受为本次有名偏差：保持记录为已覆盖GREEN，不勾选“曾观察RED”的原任务，不人为删代码制造历史。其余行为RED与评审回归证据不受影响。
3. 全仓保留且仅允许当前已有的两个MCP集成skip：real DSH MCP bridge exposes a typed tool and dispatches it；disposing the real bridge unregisters the MCP tool。原因是根依赖不含精确profile-only dsh-mcp-client。完整npm仍必须exit0且fail0；不得新增skip，不得把这两项说成通过。当前结果654total/652pass/0fail/2skip。
4. 公开skill/viewer可作限定范围验收，但完整私有迁移/生产cutover不能据此宣称完成或归档。独立review明确接受本修订后，verify才可按限定范围填写PASS_WITH_WARNINGS，同时列明这些偏差与后续未完成项。
5. 默认Anvil严格口径下原FAIL记录仍是事实；修订结果必须显式声明是用户批准的本次例外，不得声称满足全仓zero-skip或逐场景首次RED。

## 私有迁移授权边界

用户确认私有目标为inner-ohmydsh，仅新增case-verify-adapters/中的来源adapter、报告sink、私有关键词扫描和合成测试；不修改.env.local或日常配置。必须在私有仓独立绑定会话实施，单独提交；内部链接阶段1需用户参与。本公开worktree不能跨根编辑，不写入私有关键词或组织数据。

生产合入/build/重启/旧软链unlink仍暂停，未授权。公开工作树只保存通用契约和脱敏交接信息。

## Review gate

ACCEPT — core-reviewer独立复核接受限定公开实现PASS_WITH_WARNINGS，仅9条自身首次RED缺记录+2项现有MCPskip。无runtime/spec/断言放宽，不补造RED；viewer无额外行为例外。两份verify必须保留原严格FAIL历史并明确本次用户批准口径。任何新skip或目标测试失败均使本接受失效。私有实施已授权但尚未执行，生产仍未授权；完整迁移/归档不在本结论内。复核读取当前amendment、两份verify、skill任务/测试/日志及MCP真实skip代码，没有重新跑全suite，最终测试计数来自已记录Lead/作者fresh证据。

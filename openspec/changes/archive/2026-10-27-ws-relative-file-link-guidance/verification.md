# 验证与复核

2026-10-27，用户授权实现后直接受控合入；不部署、不重启。

- 产品代码仅向活动 WS 的既有 systemPrompt.context 文本追加一条指引，未修改官方包、点击处理器、文件地址协议或依赖。
- context / agent-loop-context / guard 三个测试文件共 27 tests 通过：覆盖指引区分回复链接与工具路径、清理绑定不含新指引、上下文稳定性及既有路径保护。
- worktree-session host/client typecheck 与 build 通过；change 严格校验通过。
- 人工复核完整源码与规范差异：规则限于 worktree 内文件的回复链接，工具绝对路径要求仍在；安装机制和失效绑定分支不变，无需新增运行时 hook。
- 已做过的官方纯函数验证表明，相对路径经原生 session 文件地址保持原值，以 worktree 为根恢复不重复前缀。尚未部署新插件，未执行真实浏览器点击验收，不宣称历史链接已修复或所有模型必然遵从。
- current spec 已同步。合入使用 ws-merge 预检与 --yes，需保持 main 干净并验证无冲突；不触碰无关会话工作，不清理活动 worktree。

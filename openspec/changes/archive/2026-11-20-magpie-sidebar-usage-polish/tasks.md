# Tasks

## 1. 实现与测试（用户已确认预览后补齐流程）

- [x] 1.1 两行账号布局、共享窗口名、明细隐藏文字读数、额度→用量文案；验证：插件 `npx vitest run` 603 passed
- [x] 1.2 评审要求的回归测试（两行结构、用量文案、浮层、非共享窗口）；验证：`test/sidebar-accounts.test.tsx` 16 passed

## 2. 文档与发版准备

- [x] 2.1 CHANGELOG 0.7.4、README.zh 侧栏文案、版本号 0.7.4（package.json、package-lock、dsh.yaml）；验证：`git diff` 各处一致
- [x] 2.2 隔离预览（3196 + 回环 mock）核对收起两行、组标题窗口名、明细无 Unknown、标题「Magpie 用量」；进程已停、未碰 3080
- [x] 2.3 插件 typecheck/build、仓库 `npm test` 通过

## Workflow follow-up

- 归档本 change，提交推送，处理镜像同步，确认 npm 与 GitHub Release 为 0.7.4。

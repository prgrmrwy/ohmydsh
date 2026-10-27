## 1. 改名与数据迁移

- [x] 1.1 重命名 package 目录、package.json、cordis id、route、API 路径、设置目录与客户端身份；package 测试、typecheck、build 通过。
- [x] 1.2 为设置存储增加旧路径只读迁移，旧文件不改写、不删除；保存只写新路径。

## 2. 依赖方与清单

- [x] 2.1 AUTO 策略 transport、出口守卫豁免 patch 与其测试、侧边栏品牌回归用例改用 `dsh-magpie-connector`。
- [x] 2.2 `dsh.yaml` 条目、说明、根 README 双语索引与治理测试 tier 表同步更新。
- [x] 2.3 当前 specs 更新；归档历史 change 仅保留原文，不重写为当前行为。

## 3. 消费面呈现

- [x] 3.1 在隔离 DSH 实例 + 本机 mock 网关中录制模型选择器与设置页交互 GIF，登记 `docs/SCREENSHOTS.md` 并确认单文件小于 400 KiB。
- [x] 3.2 用 archify 生成中英双语架构图 SVG 与 JSON 源，finalize 全 gate 通过。
- [x] 3.3 双语 README 重写：基础功能（网关直连）、特色功能（按 provider 分组）、Cloudflare Access、用量卡片、安装配置、移除与欢迎 issue/PR。

## 4. 验证与发布准备

- [x] 4.1 运行包测试/typecheck/build、根仓库文档治理与 facade 测试，并记录实际结果。
- [x] 4.2 发布准备：`npm pack --dry-run` 通过；已建独立 GitHub 镜像仓库 prgrmrwy/dsh-magpie-connector 并推 subtree（含 topics）。npm 发布因本机未登录返回 ENEEDAUTH，需用户 `npm login` 后执行或由仓库 release workflow（tag 触发、trusted publishing）发布。

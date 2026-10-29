---
name: remove-dsh-plugin
description: 从 ohmydsh 定制仓移除一个 DSH 插件:从 manifest(dsh.yaml)删除条目 → dsh build 卸载 → 询问用户是否重启 DSH。
whenToUse: 用户要求卸载/移除某个 DSH 插件(给出包名、npm 链接或 id)时。
---

# 移除插件(remove-dsh-plugin)

目标仓库:本 ohmydsh 定制仓(以当前工作目录所在仓库为准,不要硬编码绝对路径)。

## 流程(严格按序)

1. **定位条目**:读 `dsh.yaml`,按用户给的包名或 id 找到条目(spec 匹配 npm 名、id 直接匹配);找不到就停下来问用户。若存在 `patches/<id>.yml` 覆盖片段,一并删除。
2. **删条目**:从 `dsh.yaml` 中**删除整个条目**——不是 `enabled: false`(那是禁用,本 skill 是彻底移除)。
3. **build**:执行 `dsh build`。sync 会自动:卸载已不在 manifest 的 package(从 bundles / dependencies / node_modules 移除)、清理 preset/skill 的部署副本。确认输出无失败条目;失败 → 报告并停止。
   - **只能在主 checkout 执行。** 在 `.worktrees/<task>` 里跑会把线上部署的 local package `file:` 路径整体改指向该 worktree。身处 Worktree Session 时:先提交改动,经用户批准用 `node scripts/ws-merge.mjs <branch> --yes` 合入 main,再从主 checkout 执行 build;校验 `grep -c '.worktrees/' ~/.dsh/profiles/web/package.json` 为 0。
4. **询问重启**(必须问,不得擅自重启):问用户是否现在重启 DSH 使卸载生效,给出两个选项:
   - **立即重启**:仅当用户明确选择后执行 `dsh restart`(stop → 确认端口释放 → start,比 `dsh stop && dsh` 更稳)。先告知用户本次会话将断开;会话内执行时命令先返回"已排程",约 3 秒后才真正重启,返回 0 只表示已排程,不得当次宣称成功。重连后用 `dsh history` 按 receipt 验证;Windows 不支持会话内重启,改请用户在外部终端执行;
   - **稍后手动重启**:插件已从 profile 卸载,下次 `dsh` 启动即不再加载。
   ⚠ 卸载在重启前不生效:运行中的进程仍持有旧插件,这是残留态而非卸载失败,需向用户说明。
5. **收尾**:按用户选择说明;重启后 `dsh` 的加载清单应不再包含该插件。

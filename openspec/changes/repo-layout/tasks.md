# Tasks: repo-layout

## 1. Spikes(先验证再定实现)

- [x] 1.1 验证 preset symlink:在 `~/.dsh/.agent-presets/<id>` 建指向仓库的符号链接,确认 DSH roster 能挂载 → **结论:不能**。roster 扫描用 `readdir({withFileTypes:true})` + `Dirent.isDirectory()`,symlink 返回 false 被跳过 → preset 一律 copy + 哈希变更检测(见 design D4)
- [x] 1.2 验证 skills 落点:确认 DSH `project-*` skill 源的目录名与发现规则 → **结论已定**:project 级 = `<项目根>/.dsh/skills/<name>/SKILL.md` 与 `.agents/skills/`;user 全局 = `~/.dsh/skills` 与 `~/.agents/skills`;采用"仓库 `skills/` 源码 → sync 物化到 `~/.dsh/skills`"
- [x] 1.3 验证 `dsh plugin add file:/link:` 行为 → **结论**:`dsh plugin --profile web add <pkg>` = pnpm 安装 + 自动追加进 `dsh.profile.bundles`,重启后自动加载 bundle patch,`cordis.patch.yml` 无需手写行;幂等(重复 add 无变化);`--save-exact` 仅首次安装生效。实测安装 dsh-cost-meter@1.5.6 成功(其依赖拉到 rc.7 家族,与 rc.6 运行体并存,重启后待验证,见 4.6)

## 2. 目录骨架与 manifest

- [x] 2.1 按 design D7 创建目录骨架(`packages/`、`presets/`、`patches/`、`skills/`),加占位 README
- [x] 2.2 编写根级 `dsh.yaml`(DSH 版本 0.1.0-rc.6,含 `source`/`spec`/`note` 字段约定与校验;首个条目 = remote cost-meter)
- [x] 2.3 编写仓库根 `README.md`:说明真相源约定、sync 用法、禁用≠删除、手改回写规则、第三方定制维护约定(只存 pin + 覆盖 + 记录,不 vendor,安装前看源码)

## 3. sync 工具

- [x] 3.1 实现 `scripts/sync.mjs`:读取 manifest,按 `source` 与 type 分发物化(local package → `dsh plugin add file:`;remote package → `dsh plugin add <spec>`;preset → 复制;patch → 合并生成;skill → 复制到 `~/.dsh/skills`)
- [x] 3.2 实现生成文件标记与合并:生成 `cordis.patch.yml` 带 generated 头,按 manifest 顺序合并 enabled patch 行,写前备份(实测双探针片段按序合并)
- [x] 3.3 实现幂等与校验:二次运行 no-op 检测(实测通过);`dshVersion` 与 `scripts/dsh.fish` 的 `DSH_VERSION` 不一致时告警
- [x] 3.4 空 manifest 首跑验证:连续两次 sync 无变化、幂等(实测通过);patch 层生成带标记头的 `[]`
- [x] 3.5 实现 remote 版本比对与错误处理:已装版本与 pin 不一致时重装;安装失败给出可读错误并列出失败条目(manifest 缺失实测 exit 1 + 可读报错)

## 4. 迁移与验证

- [x] 4.1 迁移现有文件:`BACKLOG.md`、`scripts/dsh.fish` 保留原位置(design D7 本就不移动),新增骨架与 sync;git 历史保留
- [x] 4.2 启动命令:`bin/dsh`(bash & fish 通用,经 `~/.local/bin/dsh` symlink 上 PATH);默认用上次 build 启动、`dsh -b` 先 build 再启动、`dsh build` 只 build、`dsh -d` 后台、`dsh stop` 停止;版本单一来源 = `dsh.yaml`(脚本运行时读取,移除 dsh.fish 的 DSH_VERSION 常量)
- [x] 4.3 按 spec 场景验收:manifest 缺失报错 ✓、disabled 不物化 ✓(cost-meter 移除实测)、toggle 可逆 ✓(移除→重装)、双 patch 合并顺序 ✓(探针)、local/remote 混合一次 sync ✓(首条 remote)、remote pin 复现 ✓(重装后 1.5.6)
- [ ] 4.4 用 B004 单机接入作为首个真实定制(package: subagent-claude-code 接线),实战验证 sync + bundle 链路
- [ ] 4.5 更新 BACKLOG B009 状态为已设计/实施中,记录新结构文档位置
- [ ] 4.6 重启 DSH 后验证 dsh-cost-meter 在 web 正常加载(rc.7 依赖混杂风险,首个 remote 实例)

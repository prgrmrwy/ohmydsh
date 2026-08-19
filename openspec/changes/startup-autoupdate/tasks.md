# startup-autoupdate — Tasks

## 1. 依赖与检测脚本

- [ ] 1.1 `package.json` devDependencies 增加 `semver`,运行 `npm install`(或 `./scripts/bootstrap.sh`)完成安装
- [ ] 1.2 新建 `scripts/check-update.mjs`:解析 `--channel`(默认 latest)、读 `dsh.yaml` 的 `dshVersion`、node https 直连 registry 取 `dist-tags.<channel>`(5s 超时)
- [ ] 1.3 `check-update.mjs` 用 semver 比较并输出 JSON `{status: update|no-update|offline, current, latest, channel}`;人工运行验证输出正确(rc.6 → latest rc.7 / next rc.8)

## 2. bin/dsh 检测接入

- [ ] 2.1 `bin/dsh` 解析 `autoUpdate`(manifest enabled/channel + `DSH_SKIP_UPDATE` / `DSH_UPDATE_CHANNEL` 覆盖)
- [ ] 2.2 start(server 未运行)/ `-b` / `build` 三入口前置调用 `check-update.mjs`;server 已运行的 start 与 offline 分支(fail-open)按设计放行
- [ ] 2.3 整仓 `git status --porcelain` 检查:脏 → 跳过升级并输出「检测到新版本 <X>,仓库有未提交改动已跳过」;干净 → 进入升级
- [ ] 2.4 升级链①:行级改写 `dsh.yaml`(先写 `dsh.yaml.bak`)——`dshVersion` + 同族 `@deepseek-ai/dsh-*` 且 pin==旧运行体 的 depend/spec/version 一并替换
- [ ] 2.5 升级链②:重跑 `node scripts/sync.mjs`;失败 → 从 `.bak` 恢复并报错退出、不启动
- [ ] 2.6 升级链③:`git add dsh.yaml && git commit --no-verify -m "chore(dsh): auto-bump <旧> → <新>"`;失败 → 报错退出、不启动,输出手动处置指引;成功 → 继续原入口(避免重复 build)
- [ ] 2.7 `record_startup` / 日志:新增 autoUpdate 事件行(升级 from→to+channel / 跳过 version+原因 / offline),`dsh history` 可见

## 3. 配置与文档

- [ ] 3.1 `dsh.yaml` 顶层新增 `autoUpdate: {enabled: true, channel: latest}`,注释说明逃生门(`DSH_SKIP_UPDATE=1` / `enabled: false`)与频道切换(`DSH_UPDATE_CHANNEL`)
- [ ] 3.2 `README.md` 修订升级约定:默认自动追赶;`dsh`/`-b`/`build` 行为说明;逃生门与「钉在旧版」方式

## 4. 验证

- [ ] 4.1 干净工作区:伪造(或真实)可更新版本触发完整升级链,确认 commit message 与 `dsh history` 记录
- [ ] 4.2 脏工作区:验证跳过 + 启动输出说明,且不产生任何 git 动作
- [ ] 4.3 offline:不可达 registry(临时改错 URL/断网)验证 fail-open 正常启动
- [ ] 4.4 sync 失败:人为制造失败验证 `.bak` 回滚 + 报错退出不启动
- [ ] 4.5 no-update:锁定目标版本后再次运行验证零动作、无更新输出
- [ ] 4.6 `-b` / `build` 两入口各跑一遍确认检测与升级后不重复 build

# devbox 主干正式部署与隔离新 home 验证（2026-10-08）

## 已执行与边界

受用户授权：清理本机失效 local repair/staging → bridge0.6.1 shim迁移 → 受控合入/推送 → devbox主干正式部署 → 隔离新home。

主验收目标始终是devbox主干正式服务3080；隔离新home是用户另行要求的新状态安装检查，临时Host已停止，不替代正式验收。本轮只证明正式物化、Host启动与隔离新home部署门禁，**不宣称完整浏览器/真实远端forwards验收通过**。未升级WSL/VM，未重启本机DSH，未发送新模型请求或飞书消息。

## 代码与合入证据

- review base `a844cdccc9599b1ab727b4ed05ec5010a1ec7575`；提交 `d1c4c153585b3d81622ba2c18ee6e16e02e9d189`。
- `scripts/ws-merge.mjs` dry-run与`--yes`均为fast-forward；main推送origin成功。
- shim20测试、host/client typecheck与build通过；根测试321 total /319 pass /0 fail /2 skip；artifact、diff-check、严格OpenSpec均通过。
- 最后removed引用清理的focused测试/typecheck再次通过，devbox正式sync重建最终产物。

## devbox 正式部署

- host `n37-044-026`；仓库真实路径 `/data00/home/zhangyong.617/opensource/ohmydsh`，main从a844cdc拉取至d1c4c15。
- `bin/dsh build`两轮成功，第二轮 `[sync] no changes — deployment already matches manifest`。
- 正式官方dump-config成功、stderr为空；只读解析1632行/210条配置，id无重复。默认js-yaml初次拒绝`!!js`（检查器schema不认识DSH合法tag），以opaque scalar扩展schema后通过，未执行任何表达式；此检查不证明每项loader激活。
- `bin/dsh restart --no-open`成功；原端口3080新PID `656211`，仅127.0.0.1监听。
- Host为声明式Pet兼容runtime，DSH `0.2.0-rc.2`；fingerprint `93a014a6db04d05d3110553c3084e220895fa4a8ca3a604419331616f8501efe`。
- 物化版本：shim0.2.0 /bridge0.6.1 /memex0.3.0 /cost-meter1.8.4 /header0.1.0。第三方源无修改。
- 部署shim host/client产物与devbox源码构建逐字节一致；client SHA256 `57313abc598af494cabb53b19800d379de27cc4c4e470c79554465ab1bd64011`，host `142ae2b54f8b517016962bcc463d92631e9778e3e255152fb0fdeadaf9527ff9`。
- 无认证的 `/` 与探测API均401，说明认证边界在位，**不是业务API成功**；最初curl exit22由401导致，不据此判启动失败，也未继续假设API路径正确。
- 日志最近100k字符未命中历史fetch递归/loader失败/inactive required-service/locus seam unavailable字串；这是有限Host日志扫描，不能替代完整loader的浏览器证据。
- 未修改devbox既有私有overlay/历史；tracked checkout clean，原有未跟踪local repair及org patch保留。部署后的数据内容未逐项作持久化比对。

## 隔离新 home

- 全新HOME、DSH_HOME、XDG_DATA_HOME、XDG_CONFIG_HOME，独立127.0.0.1:39522；`DSH_LOCAL_MANIFEST=''`，不加载私有overlay，不导入生产历史。
- 复用已有隔离Node24.12.0与repo/launcher cache。**这是新DSH状态的冷物化，不是全新OS/空缓存/冷构建launcher证明。**
- 首轮sync exit1：`@byted/dsh-traex-bridge@0.1.16`访问公开npm404；换HOME丢失了用户registry配置。
- 单一全局bnpm重试exit1：已有better-sidebar依赖的`@codemirror/language@6.13.1`尚未镜像（bnpm最新6.13.0）。两次失败均有原始日志，未禁用插件。
- 只在隔离用户npm配置声明 `@byted:registry=https://bnpm.byted.org/`，其余保持公开npm后成功；没有复制凭据。第二次sync no changes；官方dump-config成功且无stderr。
- 显式使用声明式runtime入口启动Host，PID `690311`，HTTP401。`/proc/<pid>/environ`验证HOME、DSH_HOME、XDG data正确隔离。SIGTERM退出0；39522无listener，生产3080仍PID656211。
- 新Host日志未命中fetch递归/locus seam unavailable/required-service错误；未执行认证后的Web loader、设置交互或模型流程，不能外推到功能全通过。

## 待确认/继续

1. 用户授权仅一个专用浏览器验收agent，不启用swarm。该agent仍处于oracle整理及确认门禁，未执行浏览器trail。
2. 真实cockpit iframe入口尚未核实；远端forward成功必须经过真实握手。直连3080的`unavailable`不证明local-device，也不允许按localhost兜底。
3. 完整升级change还有先前未完成门禁；本报告不授权勾选全部任务或归档/current-spec同步。

原始构建/启动/失败日志与隔离状态只留devbox owner-only `~/.cache/dsh-acceptance/upgrade-0.2.0-d1c4c15/`。不提交认证URL/cookie/session原文或批量截图。

# devbox复跑与Connection必要性对照

被测ohmydsh源码：83c69cf796dc59d24587becf1d3ba45f29336962，运行前后clean。Node24.12.0。测试独立HOME/DSH_HOME/XDG配置/数据；远端网络通过set_sh_devbox_proxy；没有修改正式pin。

## Connection修复片段仍需要

官方`--dump-default-config`的connection行仅inject webRuntime、保持trustedHosts表达式。以官方支持的`--patch`恢复这条精确上游行，隔离39521启动，不修改生成profile。

- 负向：官方token交换303成功后，/dsh-system-clock/now返回405。未认证同样405，这是路由未注册的通用拒绝，不能宣称这里有401 fence。
- 正向：无额外overlay、使用现有connection-webserver片段启动；同RPC已认证200且result.ok=true，未认证401。
- 两次Host均核对PID/cmdline/DSH_HOME后停止，exit0。测试端口关闭，devbox生产3080仍PID2004366。
- 这补齐3.9，不证明所有插件功能或生产切换。

## 本轮回归

- 根测试：293 total，291 pass，2 skip，0 fail。
- check:artifacts：PASS。
- 所有11个local package：声明的typecheck/build均PASS；首次test有memex与worktree两组失败，未隐藏。
- Pet：2813 pass、43 skip；不把跳过项算通过，不替代真实live/coldcapacity/Feishu。
- memex首次342 pass/8 fail：新隔离PATH/prefix未指向已安装的固定内核。恢复既有global/bin和npm_config_prefix后350/350 PASS，无源码修改。
- worktree首次与第一次复测214 pass/2 fail：失败集中在要求pnpm@10.23.0的fixture安装步骤；环境默认pnpm10.16.1。使用隔离corepack pnpm@10.23.0入口后32文件216/216 PASS。无产品源码修改；工具版本选择也是验收前置条件。6.2仍不勾选，因为完整升级候选及全部场景基线比对尚未结束。
- OpenSpec upgrade-dsh-0-2-0-runtime strict与git diff --check通过。

## 已修复历史阻断

header上游a5011e0通过两种装配顺序、卸载重挂及真实Host出站；bridge7102a12通过32测试及实际浏览器激活；认证d13befa允许严格`/`和`./`，328server测试通过；本机cockpit已运行该认证产物。真实hello/选择/pending回调全部201，独立服务端聚合1→0。详见cockpit-real-integration-review.md。

这些修复尚未发布，正式manifest不得指向临时产物；历史NO-GO报告保留为历史记录，由后续证据补充，不擦除当时失败。

## 未完成与下一步分类

可继续隔离验证：Session v4合成样本读写/损坏/回滚、Settings UI完整编辑矩阵、Pet无外部副作用live/coldcapacity和client navigation。尚无充分证据，不勾选。

需要生产/私有数据或人工：私有overlay exact身份和逐工作区基线、生产Session/Pet数据备份与迁移等；不能拿fresh fixture替代。真实Feishu/media不得对未知收件人发测试消息。

需要额外实施/发布授权：0.6 forwards跨仓协议迁移、上游发布/正式pin、受控合并归档、生产构建与用户重启。

整体升级仍NO-GO；已授权本机cockpit认证修复及最小实际聚合链路通过。

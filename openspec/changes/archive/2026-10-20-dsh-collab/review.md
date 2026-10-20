# Planning Review — dsh-collab

本文件只评审规划，不是代码或真实Host验收。上一轮Anvil结果未改写。新change使用仓库默认spec-driven，apply须在本次规划交付后由用户另行启动。

## Round 1 — REQUEST_CHANGES

两位独立只读评审（9fc418a4、1df519d0）核对proposal/design/spec/tasks/test-plan、当前kernel与已装DSH0.2.0-rc.2源码；均未写产品文件、安装、部署、创建会话或运行Host。

- 安全/生命周期评审：C0、M3、minor1。
  - M1：冷恢复只看preset哨兵，不足以证明sandbox/approval/worktree权限保持。
  - M2：dataDir不向模型暴露与原样透传含lockPath的kernel details冲突。
  - M3：维护CLI不内联kernel且无运行依赖，breakLock来源不闭合。
  - minor：现有FileStore仅lock显式0600，日志open('a')默认mode，不能宣称全部0600。
- 覆盖/构建评审：C0、M2、minor2（其中两个minor与上述重复）。
  - M1：组件harness不等于发行Host，缺确切发行入口/依赖装配与normal、预算耗尽、SIGKILL各自oracle。
  - M2：冷发现不读正文但要求标题，官方补冷标题会折叠全文；需要允许标题缺省。

## 修订处置

1. spec cold-01、design D8、tasks1.2与test-plan加入真实文件/Bash/read-only/approval never/不同cwd/worktree guard的允许-拒绝对照，不能只检查projection。
2. spec工具requirement、design D3、test-plan明确安全错误投影：业务code/CAS详情与锁instanceId/pid保留，lockPath/raw lock/stack不入模型；秘密dataDir负断言。
3. design D7维护CLI为薄入口，import同包主bundle的受信维护函数，共用内联kernel；packed-copy验收同时执行CLI help/拒绝/明确死亡成功矩阵。
4. design D1收窄为真实0700目录边界；既有宽权限目录拒绝，lock0600，日志遵循kernel默认mode而不虚称0600。
5. spec发现requirement/design D2/test-plan允许冷标题缺省，只走header/list/stat，不走inspect/observe/readTitleSnapshots全文路径。
6. design D8、tasks1.3、test-plan独立子表与spec acceptance场景区分组件装配和发行Host；子ID acceptance-01-normal/budget/kill分别有明确触发与进程/锁oracle。发行入口为@deepseek-ai/dsh@0.2.0-rc.2真实bin及同版host-runner；当前根缺发行体是明确前提阻断，不静默安装、不借日常profile、不自写signal handler/timer伪装真实预算。无可核验正常停机预算则该项保持未验证。

## Round 2 — Trust / Build Recheck APPROVE

独立复核94265134：APPROVE，C0/M0/minor0。完整重读6规划工件并对照kernel/DSH真实源码，确认上述权限oracle、错误投影、维护bundle来源、目录权限边界及冷发现修订；未发现新规划阻断。该复核已检查发行Host硬依赖/真实信号要求，最后更细的normal/budget/kill表追加后另作专项复核。

## Round 3 — Shutdown Gate Recheck APPROVE

独立专项复核ff58bcf8：APPROVE（仅planning）。确认design D8、tasks1.2/1.3、test-plan发行Host子表与spec最后requirement一致：组件层不冒充发行体，normal/budget/kill分别有输入和退出/锁oracle；真实发行入口缺失为前提阻断，无正常shutdown预算来源就保持未验证。亦交叉核验冷标题缺省、错误脱敏、0700目录承诺与薄维护CLI资源复用，无新明显冲突。未安装、部署或运行Host实验。

DECISION: APPROVE

## 最终状态

所有实现任务保持未勾选，30主场景均未实现；新增加的发行Host子ID也未验证。独立规划批准不能替代运行体缺口或真实实验结果；实施前先完成tasks1.2/1.3门，遇缺少发行体/预算来源应回报用户而非继续宣称全绿。

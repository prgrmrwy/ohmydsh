# 隔离组件探针

[English](README.md) · 简体中文

本目录覆盖任务1.2组件接缝、真实打包consumer集成和独立官方CLI关闭门，不向日常profile部署。包内npm test运行unit、npm pack和隔离sync副本测试；test:components构建并跑两组真实组件；test:host运行consumer关闭门。

现有根依赖的4项测试：

```sh
node packages/dsh-collab/test/run-components.mjs
```

完整Controller探针需先获准准备测试依赖，并执行`ws promote`；随后只在忽略的隔离目录安装：

```sh
mkdir -p spike/collab-components
cp packages/dsh-collab/test/support/component-dependencies.json spike/collab-components/package.json
npm install --prefix "$PWD/spike/collab-components" --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund
npm ls --prefix "$PWD/spike/collab-components" --all
node packages/dsh-collab/test/run-components.mjs --controller
```

已验证Node v24.20.0、npm11.19.0；Worktree源码转译使用现有根依赖TypeScript5.9.3。配方精确固定顶层DSH0.2.0-rc.2、Cordis4.0.4及loader1.0.5/include1.0.9/group1.0.4，防新patch引入不兼容peer；不代表锁定全部传递依赖，不新增第二份受控lock。复跑检查`npm ls --all`，不使用force或legacy-peer-deps。旧fixture若残留不兼容嵌套依赖，只可核验精确路径后重建该隔离目录依赖，不能删除根依赖或日常profile。

runner清空继承凭据，创建临时HOME/DSH_HOME，仅启动Node测试子进程与ScriptedAdapter；清理前验证临时目录真实父目录和前缀。不会读取用户会话、调用外部模型、启动完整DSH/webserver或使用日常profile。真实credentials后端可能生成fixture内部认证秘密，不打印或长期保留。

基础探针覆盖真实调用身份、busy/idle followup和JSONL落盘重读。Controller探针覆盖真实服务装配、P1切P2后新Context官方冷恢复、实际工具schema、相对文件路径及默认Bash cwd、read-only文件和Bash允许/拒绝、never审批拒绝审计。Bash不可用、超时或runner失败不算策略拒绝。

Worktree用例使用临时真实Git repo/worktree，将4个现有Worktree源码模块转译到fixture，在agent/created调用真实恢复及guard。它证明官方冷恢复发布时的组件hook，不代表完整Worktree插件HTTP/归档/reconciliation已装配。

## 官方CLI启停门

另行获准并`ws promote`后准备隔离官方CLI，不与组件图混用：

```sh
mkdir -p spike/collab-host
cp packages/dsh-collab/test/support/host-dependencies.json spike/collab-host/package.json
npm install --prefix "$PWD/spike/collab-host" --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund
npm --workspace packages/collab-kernel run build
node packages/dsh-collab/test/released-host-seams.mjs
```

测试直接运行原版官方bin及临时空bundle profile，不起webserver。native fixture只持有真实FileStore并注册Cordis disposer，不注册signal或终止timer。SIGTERM和5000ms全树关闭预算均来自官方profile-boot。budget用例在关停前将真实commit卡在fsync，外部15秒只负责测试失败清理，绝不算预算成功。正常关闭与预算到期都可能code0，所以额外检查close标记、锁、耗时与重开日志。SIGKILL残锁先验证默认LOCKED，ESRCH且精确实例ID后才维护解锁。所有子进程收集退出，临时home核验后清理。这是任务1.3的kernel/Host接缝，不是未来dsh-collab包装器的最终集成验收。

实际打包consumer用`npm --workspace packages/dsh-collab run test:host`。官方root持有native probe，probe装配同一真实Controller graph并等待生产插件dispose；consumer/preset哨兵用同一官方依赖图，比较canonical模块URL。它证明官方进程关闭包裹真实生产teardown，不使用外部模型。同一命令额外执行official-composition.mjs：真实服务和consumer作为同级profile行由官方loader装配，随后重启重试原收据；能力fixture仅提供本地脚本模型和合成会话。barrier位于物理append handle的sync调用，不是操作系统挂死实测。每次停止及部署consumer受信恢复后，再用官方进程重开同consumer，重试原cmdId、核收据/serviceId/成员绑定/日志字节不变。隔离sync使用仓库复制installer fixture但真实tsdown和部署副本import，不声称真实包管理器安装验收。

AgentLoop可能捕获driver错误，所以whenIdle本身不是成功证据；测试同时检查错误、请求数量、实际工具与completed回合。组件探针通过不能直接把30个consumer验收场景标绿。

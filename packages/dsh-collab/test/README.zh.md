# 隔离组件探针

[English](README.md) · 简体中文

本目录只证明任务1.2的组件接缝，不是已部署的协作插件，也不替代任务1.3发行Host启停实验。

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

AgentLoop可能捕获driver错误，所以whenIdle本身不是成功证据；测试同时检查错误、请求数量、实际工具与completed回合。组件探针通过不能直接把30个consumer验收场景标绿。

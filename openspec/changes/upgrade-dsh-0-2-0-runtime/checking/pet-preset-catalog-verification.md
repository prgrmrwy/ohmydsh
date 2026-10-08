# Pet真实Host预设目录与executor声明：只读一致性通过

对象：devbox83c69cf隔离0.2.0-rc.2 Host，39521；生成配置来源为frozen-sync-fixture。没有agent创建、preset mount、Task/Invocation或模型调用。

实际读取/presets、/status、/capabilities均HTTP200且Pet结果ok。Host预设目录5项：standard、ptc、minimal、cordis、dsh-pet-executor；能力目录1项，但未执行能力。

读取真实profiles/web/cordis.patch.yml，并按Cordis patch insert语义查preset-dsh-pet-executor：name=@deepseek-ai/dsh-agent-preset，config.id=dsh-pet-executor，plugins包含bash/tool-skill/workflow-ptc，排除dsh-skill-filesystem和旧workflow-worker-thread。分组结构是group:true/config:[rows]，不是group数组。

profile patch SHA256=cc0a88d7fc49490c141c20202d04ddbbf082d1c302dfda391e7f008a595f8f7f；这是本轮文件快照hash，不把它当通用版本pin。

前置探针错误保留：误猜patch.cordis.yml文件名、误把insert声明当顶层row，以及误将group:true当数组；分别通过sync源码和实际profile结构修正。仅修探针oracle，没有产品代码修复或削弱字段断言。最终probe exit0。

目录存在只证明Host接受声明并发布目录，不证明工具实际装配：index.ts3366的agentPresets.list不同于1001/2921的mount路径。docs/notes/dsh-plugin-integration-pitfalls.md已明确meta.agentPreset只记名不能证明工具挂载。因此actualPresetMountVerified=false，5.8仍未完成。

候选PID2456818核cmdline/DSH_HOME后SIGTERM，exit0；生产3080仍PID2004366。未改本机DSH/VM、正式pin或发布。整体升级NO-GO。

## 后续普通官方创建路径检查（不等于Pet路径）

官方session-controller/commands.ts105–144的create独立于prompt；agent.ts381–395的composeAgent在setup明确await presets.mount，480–494的create传入该setup。本轮实际session/create指定standard及dsh-pet-executor均结果ok，返回preset匹配，session/projections.values.agentPreset匹配。skills/list读取live agent preset serviceFor作用域，标准60项、executor17项，存在实际运行作用域差异。

只调用session/create、session/projections和skills/list，没有prompt、request/header或模型调用。前次探针错误将projection值当顶层读取，按index.ts502的{asOfSeq,values}修正后通过。首次失败已创建1个standard，随后成功创建2个空会话：三者保留在隔离候选作为测试数据，不伪报已删除；停止Host已释放运行体。

这是普通官方创建时mount成功及scoped skill差异，不是Pet createLocusChild/executor的实际路径。普通创建没有Pet专属allowlist provider，17项不证明Pet skill允许清单隔离。没有公开工具目录读取Remote；未为采集request/header.tools提交模型请求。toolCatalogVerified=false、petCreationPathVerified=false，5.8仍未完成。

候选PID2464298经身份核验SIGTERM正常exit0；生产3080仍PID2004366。

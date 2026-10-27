# 仓库原生 mock 探测

先从oracle抽取数据态：empty、few/many、分页筛选、long、error/timeout、permission、dirty、状态组合。枚举同数据源的所有surface，记录矩阵；不能在首页通过就推断侧栏也通过。

只复用已发现的方案，按以下证据检查：
- mock/mocks/fixtures/__fixtures__/data目录及相关README；
- package scripts、开发文档、env示例中的开关；
- MSW、Mock.js、devServer/proxy、框架mock插件、拦截器、service worker；
- API adapter、localStorage/sessionStorage seed。

每条结论记录来源文件/行号、命令或配置key，不用“通常有/看起来可以”。

- available：明确方案且能启动；记录handler/fixture/env、启用、退出/回滚、覆盖checkpoint及surface。
- missing：检查后确认没有可用方案。
- unknown：配置模糊、运行未验证或无法确认覆盖场景。
- not_needed：不依赖该数据态。

missing/unknown且需要mock时暂停，展示场景、关联checkpoint、检查过的证据，让用户选择提供方式、人工、跳过或先补mock。没有选择不得进入依赖它的自动trail。用户说skip只影响该场景，不代表其他范围失败或免验。

available无evidence由validate_mock_gate拒绝；cp级mock_status缺口还需要cp级mock_user_decision。执行前再次核实，不可在启动失败后换一个猜测方案继续。回滚产品mock修改、seed和profile状态，避免污染其他worker。

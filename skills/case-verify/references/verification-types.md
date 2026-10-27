# 验证类型与证据纪律

## assert_dom
检查selector唯一性、可见性、文本/属性/值。不能只断言按钮存在就算交互通过；点击/输入后需后果，如列表落位、值回读、弹窗关闭、toast。编辑后刷新再读以验证持久化。工具返回成功不等于页面变化。

## assert_network
在操作前开始观测，操作后等待至多10秒，核对URL/method/params/status/响应中明确期望字段。未观察到请求写清限制，不凭同名历史请求补PASS。网络原始正文可能含敏感信息，本地保存且不公开；共享步骤证据标scope=shared-step。

## assert_url
读取实际URL，对明确pattern匹配；重定向登陆或错误页视为环境阻塞，不把“发生了跳转”当正确目标。URL断言不能替代必要的目标页渲染检查。

## screenshot_compare
同时保存当前截图和基准来源，结构化说明布局、文字、尺寸/溢出等差异。基准必须来自用户确认的设计/既有基线；没有基准不可凭实现反推，改partial或manual。多数据、长文本场景检查固定高度、滚动、截断与tooltip；一个viewport的截图不能覆盖其他设备。

## visual_inspect
截图供人工确认，status=manual，不自动绿。说明预期、实际与需要人判断的点，不写模糊“看起来正常”。

## 交互扩展

破坏性动作检查二次确认/可撤销；文本检查最大长度、空值、特殊字符、前后空格；新建/编辑/提交检查后果；IME需要真实composition能力，否则manual。oracle没有给边界期望时先上报oracle_gap，derived检查不得提升原需求通过率；实现推断expected_unverified不得PASS。

所有证据使用精确相对路径，存在且sha256受审计。截图或DOM采集失败不找同批次任意文件替代；pass/fail无证据需limits原因。实际结果不符fail，没加载/没登录/缺数据blocked，天然不能自动化manual，范围局部覆盖partial。区别是观察事实，不是为了美化通过率。

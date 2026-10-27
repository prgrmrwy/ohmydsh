# 浏览器引擎

先执行agent-browser --version并检查退出码。可用就必须用它；只有不可用才选择Chrome MCP。没有引擎时停止，不把HTTP请求或CLI返回成功冒充黑盒验收。

统一动作：navigate、click、fill、hover、press_key、wait_for；统一观测：DOM/可见文本与属性、URL、network、截图。按引擎实际工具能力执行，不猜测未注册API。

开始前：确认URL、登录、设备viewport、mock、当前页面；观测脚本先dry-run。控件定位优先可访问角色/稳定test-id，模糊文字选择器必须确认唯一性。切换iframe/标签页时重新确认被测surface。

动作后：复读可见结果或相关数据，特别是编辑器fill空串、提交、删除、滚动、折叠，不以动作成功作断言。

重试与暂停：动作最多额外2次（间隔2秒）；等待8秒；network最多10秒；单trail硬上限3分钟。登录跳失立即暂停请用户重登，确认后从断点续跑；mock/后端阻塞记录blocked。已渲染但缺期望必须fail。

按计划设备设置，不把desktop截图推断为mobile；desktop/mobile或不同角色分别env记录。恢复所用mock/profile/viewport状态，避免影响用户或其他worker。

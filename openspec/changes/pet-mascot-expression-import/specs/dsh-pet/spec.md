## ADDED Requirements

### Requirement: 动画表情以状态目录下的单文件持久化

Pet SHALL 允许所有者导入一段 Lottie JSON 作为吉祥物动画，并把原文保存在 `$DSH_HOME/plugins/dsh-pet/expressions/active.lottie.json`（0600 文件、0700 目录）。动画内容与生效状态 MUST NOT 写入 SQLite、Pet 领域数据库或配置投影；导入与移除只允许在 `expressions/` 内写文件。导入 SHALL 先写唯一临时文件再重命名覆盖（POSIX 上为原子替换；其它平台允许以保留旧文件的兜底顺序完成）；移除 SHALL 把生效文件改名为同目录的最近一份备份 `active.lottie.json.removed`，并在无生效素材时幂等成功。

#### Scenario: 导入合法动画后读取到原文
- **GIVEN** 当前没有生效动画，且导入内容通过全部校验
- **WHEN** 所有者调用导入路由提交该内容
- **THEN** `expressions/active.lottie.json` 存在且其 UTF-8 字节数与提交内容相同；随后读取路由返回 `state: 'ok'` 且 `content` 与该字符串完全相等

#### Scenario: 读取不落库且不触碰数据库文件
- **GIVEN** Pet 使用内存介质的测试 harness，`state.sqlite` 不存在
- **WHEN** 依次执行导入、读取、移除
- **THEN** 临时 DSH home 下没有创建 `state.sqlite`，且只有 `expressions/` 目录内容发生变化

#### Scenario: 无生效素材时读取返回 none
- **GIVEN** `expressions/` 目录为空
- **WHEN** 客户端读取动画表情
- **THEN** 读取返回 `state: 'none'`，不报错、不创建文件

#### Scenario: 移除后保留备份且重复移除幂等
- **GIVEN** 已有生效动画
- **WHEN** 连续两次调用移除路由
- **THEN** 两次调用都成功；`active.lottie.json.removed` 保存移除前的原文；`active.lottie.json` 不存在；读取返回 `state: 'none'`

#### Scenario: 重复导入覆盖上一份且不产生备份
- **GIVEN** 已有动画 A
- **WHEN** 所有者导入另一段合法动画 B（确认替换后）
- **THEN** 读取返回 B 的内容，A 不再可读，且导入过程不创建 `.removed` 备份

#### Scenario: 已有动画时导入先提示替换
- **GIVEN** 已存在生效动画
- **WHEN** 所有者打开动画导入区域并尝试提交新内容
- **THEN** Settings 先展示「当前动画将被替换且不保留，如需保留请先复制导出」的提示，确认前不发送导入请求

#### Scenario: 导出读取到原文
- **GIVEN** 存在生效动画
- **WHEN** 所有者请求读取以复制导出
- **THEN** 响应中的 `content` 与生效文件内容逐字符相等，可用于再次导入

### Requirement: 导入内容在 Host 侧受内容安全校验

Host SHALL 在写入前校验导入内容，不合规时 MUST 返回 `INVALID_EXPRESSION`（HTTP 400）且不改变当前生效素材。校验 MUST 覆盖：有效 UTF-8；合法 JSON 对象；`layers` 非空且每层含数字 `ty`；`assets` 若存在必须为数组、`id` 唯一，`p`/`u` 仅允许空串或可解码的 `data:image/` 位图；`fonts.list` 条目 `fPath` 若存在必须为空、`fFamily` 限安全字符；按 `refId` 展开的渲染图总层数 ≤80、深度 ≤32、拒绝环与类型不匹配；`w`/`h`（含 precomp）≤2048。

#### Scenario: 缺少 layers 或层缺少 ty 被拒绝
- **GIVEN** 已有生效动画 A
- **WHEN** 导入 `{}`、`{"v":"5.0.0","w":100,"h":100,"layers":[]}` 或 `{"v":"5.0.0","w":100,"h":100,"layers":[{}]}` 这类内容
- **THEN** 返回 `INVALID_EXPRESSION`（HTTP 400），A 仍生效且读取返回 A 的原文

#### Scenario: 非法 JSON、顶层非对象或缺少 v 被拒绝
- **GIVEN** 导入内容为不可解析文本、JSON 数组或缺少字符串 `v` 的对象
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，不写入文件

#### Scenario: assets 非数组被拒绝，缺省或空数组通过
- **GIVEN** 导入内容的 `assets` 为对象、非数组，或某个 asset 不是对象/缺少唯一字符串 id
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`；合法的缺省 `assets` 或空数组则通过

#### Scenario: 顶层或 precomp 的 w/h 非法被拒绝
- **GIVEN** 顶层或 precomp 的 `w`/`h` 为 0、负数、超过 2048 或非数字
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，诊断指出对应字段

#### Scenario: 无法往返的 UTF-8 或非字符串正文被拒绝
- **GIVEN** 请求正文含未配对代理项，或 `content` 字段不是字符串
- **WHEN** 调用导入路由
- **THEN** 非法字符串返回 `INVALID_EXPRESSION`，非字符串字段返回 `INVALID_REQUEST`，两者都不写入文件

#### Scenario: 前后空白被原样保留
- **GIVEN** 一段前后带换行/空格、其余合法的 Lottie JSON 文本
- **WHEN** 导入后读取
- **THEN** 读取到的 `content` 与提交文本完全相等（未被 `trim`）

#### Scenario: 远程或相对资源引用被拒绝
- **GIVEN** 导入内容含 `assets`，且 `p`/`u` 为 `https://…`、`//…`、`../…`、数组或对象之一
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，文件系统不产生新文件

#### Scenario: 仅允许可解码的内嵌位图 data URI
- **GIVEN** 导入内容含 `assets[].p` 为 `data:image/png;base64,…`
- **WHEN** Host 校验并导入
- **THEN** 可解码的 PNG/JPEG/WebP/GIF 导入成功；`data:image/svg+xml`、base64 无法解码或魔数不匹配的内容返回 `INVALID_EXPRESSION`

#### Scenario: image 层通过 refId 引用内嵌位图，类型不匹配被拒绝
- **GIVEN** 一段 Lottie 含 `ty:2` 图层，其 `refId` 指向 `p` 为合法 PNG data URI 的 image asset；另有一段 `ty:0` 图层指向同一个 image asset
- **WHEN** Host 校验这两段内容
- **THEN** 前者通过并成功导入；后者返回 `INVALID_EXPRESSION`，诊断指出 `refId` 目标类型不匹配

#### Scenario: 远程字体或非法字族被拒绝
- **GIVEN** 导入内容含 `fonts.list[].fPath` 非空，或 `fFamily` 含引号、分号、花括号等字符
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，不写入文件

#### Scenario: 按 refId 展开的渲染图超限或成环被拒绝
- **GIVEN** 顶层 1 层通过 `refId` 指数级引用 precomp，或 precomp 自引用/成环，或展开后总层数超过 80
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，诊断（`fields`）指出 `layers`/`refId`/层数上限

#### Scenario: precomp 引用深度超过上限被拒绝
- **GIVEN** precomp 引用链长度为 33、每条 precomp 仅含 1 层（展开总数低于 80，确保深度判据是被拒原因）
- **WHEN** Host 校验该内容
- **THEN** 返回 `INVALID_EXPRESSION`，诊断指出引用深度上限

#### Scenario: 正常嵌套 precomp 与嵌套尺寸通过校验
- **GIVEN** 顶层引用一个 2 层 precomp，`refId` 指向存在且无环，所有 `w`/`h` ≤2048
- **WHEN** Host 校验该内容
- **THEN** 校验通过并成功写入

#### Scenario: 读取损坏或超限文件返回 corrupt 而非抛错
- **GIVEN** `active.lottie.json` 被手动改坏、或文件超过 512 KiB 读取上限
- **WHEN** 客户端读取动画表情
- **THEN** 返回 `state: 'corrupt'` 与可读诊断，Host 不返回 500

### Requirement: 管理路由的请求体上限按路由区分

本 change 的导入路由 SHALL 单独允许 ≤ 4 MiB 请求体；其余所有 Pet 管理路由 MUST 保持 256 KiB 上限。超过对应上限 SHALL 返回 `INVALID_REQUEST`，不写入任何文件。素材本身 512 KiB 的上限属内容校验（上一 requirement），两者错误码 MUST 可区分。

#### Scenario: 素材超限但请求体未超限时返回素材错误
- **GIVEN** 一段体积约 600 KiB 的合法 Lottie JSON
- **WHEN** 通过导入路由提交
- **THEN** 请求体被接受，校验以 `INVALID_EXPRESSION` 拒绝，生效素材不变

#### Scenario: 超过 4 MiB 的导入请求被请求体上限拒绝
- **GIVEN** 一段超过 4 MiB 的请求体
- **WHEN** 调用导入路由
- **THEN** 返回 `INVALID_REQUEST`（请求体过大），不写入任何文件

#### Scenario: 其余管理路由维持 256 KiB 上限
- **GIVEN** 一个 300 KiB 的请求体
- **WHEN** 调用状态读取等非导入路由
- **THEN** 返回 `INVALID_REQUEST`（请求体过大），行为与本 change 之前一致

### Requirement: 支持从 HTTPS URL 导入动画表情

Pet SHALL 允许所有者提交一个 URL，由 Host 下载并复用与粘贴相同的校验与存储流程。下载 MUST 仅允许 https、默认 443 端口、不带凭据；MUST 拒绝 localhost/内网主机名与私有/保留 IP；MUST 校验主机解析出的全部地址均为公网，并把该地址 pin 到实际连接（连接阶段不得再次解析）；重定向 MUST 最多 3 跳且每跳重新校验；整体请求 MUST 在 10 秒内结束（含 DNS 与全部重定向）、响应 ≤512 KiB、content-type 限 JSON 类，且连接 MUST 只使用已校验地址（不得经环境代理或二次解析）。URL 被拒时 MUST 不发起请求；下载失败 SHALL 返回 `EXPRESSION_FETCH_FAILED`（HTTP 502）；下载内容校验失败 SHALL 返回 `INVALID_EXPRESSION` 且现有素材不变。

#### Scenario: 从 HTTPS URL 导入合法动画
- **GIVEN** 一个公网 https URL 返回合法的 Lottie JSON（经重定向后仍为公网 https）
- **WHEN** 所有者调用 URL 导入路由
- **THEN** Host 下载内容并写入生效文件，读取路由返回 `state: 'ok'` 且 `content` 与下载内容相同

#### Scenario: 非 HTTPS 或内网目标被拒绝且不发起请求
- **GIVEN** URL 为 `http:`、带凭据、非默认端口，或主机为 localhost/内网名/私有或保留 IP、或 DNS 返回任一私有地址
- **WHEN** 调用 URL 导入路由
- **THEN** 返回 `INVALID_REQUEST`（HTTP 400），且没有向该 URL 发起任何 HTTP 请求

#### Scenario: 重定向到内网或次数超限被拒绝
- **GIVEN** 公网 URL 重定向到内网地址，或连续重定向超过 3 次
- **WHEN** 调用 URL 导入路由
- **THEN** 分别返回 `INVALID_REQUEST`（内网目标）与 `EXPRESSION_FETCH_FAILED`（次数超限），且不写入文件

#### Scenario: 下载失败返回可诊断错误且现有素材不变
- **GIVEN** 已有生效动画，URL 返回非 2xx、超时、非 JSON 内容类型或超过 512 KiB
- **WHEN** 调用 URL 导入路由
- **THEN** 返回 `EXPRESSION_FETCH_FAILED`（HTTP 502），现有素材与读取结果保持不变

#### Scenario: 下载内容不是合法 Lottie 时返回 INVALID_EXPRESSION
- **GIVEN** URL 返回 2xx JSON 但不是合法 Lottie（如缺少 `layers`）
- **WHEN** 调用 URL 导入路由
- **THEN** 返回 `INVALID_EXPRESSION`（HTTP 400），不写入文件、现有素材不变

### Requirement: 吉祥物渲染、回退与可诊断

存在有效动画时，吉祥物 SHALL 渲染该动画并 MUST NOT 同时显示 glyph；glyph 只在无生效动画、读取为 corrupt 或渲染失败时显示。渲染失败 MUST 通过事件与时序判定：订阅播放器 `error`/`onError`，在 `DOMLoaded` 后的有界窗口内检查渲染容器；`isLoaded` MUST NOT 作为唯一即时判据；可绘制节点 MUST 排除 `g`/`defs`/`clipPath`/`mask` 等容器，只认真正的绘制元素。失败 SHALL 销毁播放器、回退 glyph，并写入客户端共享诊断状态供 Settings 展示。播放策略 SHALL 由 `reducedMotion || document.hidden` 决定：为真时 MUST 不播放，且在整个期间对可见性变化都不得恢复播放。

#### Scenario: 动画优先于 glyph
- **GIVEN** 存在有效动画且用户同时配置了自定义 glyph
- **WHEN** 吉祥物完成挂载
- **THEN** 吉祥物渲染动画容器且不渲染 glyph 文本

#### Scenario: 渲染失败时回退 glyph 并显示诊断
- **GIVEN** 播放器触发 `error`/`onError`、`DOMLoaded` 后容器只有容器节点（或空 shape 层），或存在无法解码的内嵌图片
- **WHEN** 吉祥物尝试挂载动画
- **THEN** 播放器被销毁、吉祥物显示 glyph，且 Settings 外观页能读到并显示这次失败的原因

#### Scenario: 读取为 corrupt 时显示 glyph 并暴露诊断
- **GIVEN** 读取路由返回 `state: 'corrupt'`
- **WHEN** 吉祥物完成一次读取
- **THEN** 吉祥物显示配置的 glyph（不挂载播放器），Settings 外观页显示该诊断文本

#### Scenario: 减少动效或页面隐藏期间不播放
- **GIVEN** `prefers-reduced-motion: reduce`，或页面处于隐藏状态
- **WHEN** 吉祥物挂载动画并随后反复切换可见性或动效偏好
- **THEN** 播放器在这些状态期间从不进入播放；只有两者都不为真时才播放，reduce 下始终停在首帧

#### Scenario: 导入与移除无需刷新即生效
- **GIVEN** 吉祥物已挂载并显示 glyph
- **WHEN** 所有者完成一次成功导入或移除
- **THEN** 吉祥物在一次广播后切换为动画或回退为 glyph，页面不重载

#### Scenario: 迟到的旧读取结果不覆盖新状态
- **GIVEN** 一次导入触发的读取尚未返回，随后发生移除并完成新的读取
- **WHEN** 旧读取的响应最后才到达
- **THEN** 吉祥物保持移除后的 glyph 状态，不重新挂载已移除的动画

#### Scenario: 测试环境导入客户端入口不求值真实播放器
- **GIVEN** 在 jsdom 下导入 `src/client/index.tsx` 或 overlay 模块（不提供浏览器 canvas 实现）
- **WHEN** 模块加载、测试挂载与卸载完成
- **THEN** 真实 lottie 播放器被测试环境的模块别名替换而未求值，测试进程不抛错；生产构建仍只从浏览器入口导入 light 构建

### Requirement: 播放器依赖与许可随包发布

Pet SHALL 使用 MIT 许可的 lottie-web light 构建（固定版本）提供播放能力，并只经浏览器入口注入播放器。package MUST 包含该依赖的版权与许可声明文件，且该文件 MUST 出现在 `package.json` 的 `files` 白名单中。系统 MUST NOT 内置或分发任何第三方动画素材；用户自备素材的来源与许可由用户负责，并在文档中说明。

#### Scenario: 发布清单包含播放器许可声明
- **GIVEN** 读取 `packages/dsh-pet/package.json` 的 `files` 与仓库中的声明文件
- **WHEN** 运行覆盖该契约的自动化测试
- **THEN** 许可声明文件存在、内容包含 lottie-web 版本与 MIT 文本，且 `files` 白名单包含该文件名

#### Scenario: 只使用 light 构建并由浏览器入口注入
- **GIVEN** 客户端源码
- **WHEN** 检查播放器依赖的导入位置
- **THEN** 只有浏览器入口（`src/client/index.tsx`）导入 `lottie_light.min.js`，overlay/渲染模块不在模块顶层导入真实播放器

#### Scenario: 仓库不内置动画素材
- **GIVEN** 仓库与 package 的发布清单
- **WHEN** 检查是否存在随包分发的 `.lottie.json` 素材
- **THEN** 除测试夹具外不存在任何内置动画素材文件

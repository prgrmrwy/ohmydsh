## MODIFIED Requirements

### Requirement: 当前 Delivery 的图片由 Host caller-bound 取得

系统 SHALL 通过官方 `lark-cli` 在受守卫的私有落盘目录内取得当前请求绑定消息中的图片。该 binary SHALL 与 Pet 订阅、身份与出站调用使用的 `lark-cli` 为同一解析结果；其 `--version` 报告的版本 SHALL 不低于 Pet 已审查的最低版本 `1.0.97`，版本缺失、不可解析或低于下限时媒体 SHALL 不可用。系统 MUST NOT 以版本作为隔离依据：私有目录、有界下载与结算前删除的不变量 SHALL 对任何放行版本同等生效。Host SHALL 从已接受 Delivery 的不可变触发 `messageId` 枚举资源，并只取得该消息内的图片；模型 MUST NOT 提供 chat、message、thread、file key、本地路径、URL 或其它目标 selector。

资源枚举、下载与 attachment 提交 SHALL 绑定该 Delivery 的 active locus/generation/child；在保存与最终入队前 SHALL 重验它仍是同一 current Delivery。若 Delivery 已终结、晋升或代际改变，Host SHALL 丢弃未发布结果且 fail closed。

#### Scenario: 官方 CLI 与私有落盘目录已证明
- **WHEN** 官方 binary 可解析且报告的版本不低于 `1.0.97`，私有落盘目录存在、权限为 0700，且位于 Locus child 读取守卫拒绝的 root 内
- **THEN** Host 以该目录为 spawn cwd 调用该 CLI 取得 current message 图片，且不向项目目录写入任何字节

#### Scenario: 更高版本无需改动即放行
- **WHEN** 官方 binary 报告的版本高于 `1.0.97`（例如 `1.0.98` 或 `1.1.0`）
- **THEN** media port 可用，且私有目录、尺寸上限与结算前删除的约束照常生效

#### Scenario: CLI 或私有目录不可用
- **WHEN** 官方 binary 缺失、不可执行、未报告可解析版本或版本低于 `1.0.97`，或私有落盘目录缺失、权限不符或不被 child 守卫覆盖
- **THEN** media port 保持 unavailable，不枚举、不下载、不保存 attachment，文字 Delivery 继续，诊断中给出实际版本与所需最低版本

#### Scenario: Delivery 结算后迟到下载
- **WHEN** 图片下载已开始但 current 随后终结或被下一条 Delivery 替换，旧下载才完成
- **THEN** Host 拒绝提交或投递结果，不把旧资源注入新 Delivery

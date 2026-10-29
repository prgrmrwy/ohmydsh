# 私有侧本地交付状态

来源：case-verify-public-private协作空间，inner成员消息24；以下为私有会话报告的实际执行结果，公开会话未跨根读取或独立复验。不包含内部原文、关键词、凭据或用户身份。

## 已报告完成

- 实现commit：a121fe7c5909ed34d6f6ff2e41dcc5750be3c404。
- 完成记录commit：cb114d91889d0c7e16dd91403a7fda6d19d26d32。
- 工作区干净，未push/合入；私有OpenSpec13/13。
- 合成测试40pass/0fail/0skip，含真实公开wrapper/gate、两次成功push至假客户端、三类失效报告零sink调用。
- 扫描公开skill35文件/0命中/complete=true，exit0；strict与diff-check通过。
- 独立首评/复核共8项问题修复后，无阻断本地交付的Important/Critical。
- 来源客户端按用户裁决采用实际全量响应，未虚构分页。

## 仍未完成或有风险

- 真实链接阶段1、SSO/CORS/图片重定向与真实文档往返尚未验；需要私有会话本机用户授权并参与登录、提供链接。
- 真实报告外发必须另问用户；假客户端成功不是平台往返验证。
- 历史loop严格内容比较可能因Markdown规范化安全拒绝，私有README已披露。
- 未改.env.local或日常配置；未部署/重启/unlink。

## 当前协商

公开接口保持冻结，真实来源若暴露差异只传脱敏最小反例，由各自会话在各自写域修复。公开限定验收不因此升级成整个生产迁移完成。原任务71.5包含实际内部链接验证，继续保持未完成。

## 联合隔离验收（2026-10-28）

- 公开实现已提交02a234e8（未合入main：受控ws-merge因主checkout另有未提交工作拒绝，未push）。
- 隔离构建：DSH_HOME与XDG_DATA_HOME均指向ws隔离home，两次构建，第二次"no changes"，case-verify已部署隔离home。首次未隔离XDG时同步脚本拒绝覆盖本机未托管的anvil schema，未写入。
- 合成端到端（inner执行）：17步含fetch→freeze→confirm→observe→报告门禁→两次push（create/update仅追加Loop2）；错rev拒绝且日志不变；篡改报告push零调用。公开脚本SHA已核对。
- Viewer（公开侧执行）：隔离部署的view.py读取复制到ignored scratch的合成目录，health200，catalog无绝对路径，浏览器双视角/lightbox/Escape正常；合成PNG为26字节非可解码图（数据问题，非viewer缺陷）。
- 真实来源阶段1（inner执行，本机用户在其会话亲自确认）：单条只读拉取，match/fetch/fragment门禁均exit0，24items，认证与4张图片下载正常，无截断。发现3个私有映射语义缺口：title与expected完全相同、图片关联到全部项且未去重、.fragment-*暂存残留；均属私有adapter层，公开接口无需改动。
- 私有修复（本机用户在inner会话批准）：私有main 0c3678208511adf3e5d1fe6fb122ee431224106e，44 tests/0 skip/0 fail。同链接只读重拉：title==expected 0/24（修复前24/24）、path不含预期原文、带图项4/24（修复前24/24）、去重后下载1张、无暂存残留；片段门禁exit0。公开扫描35文件0命中。
- 公开侧复核修复后合成e2e：隔离部署view.py health200，path仅树层级，catalog无绝对路径；真实1×1 PNG证据在浏览器解码naturalWidth=1，Escape关闭。
- 真实报告外发未执行；生产部署/重启/软链切换未执行。

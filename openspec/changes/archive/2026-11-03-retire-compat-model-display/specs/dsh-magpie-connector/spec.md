## REMOVED Requirements

### Requirement: 选择器按网关归属展示分组（AMD2）
**Reason**: Magpie 已按网关归属注册真实 route，原版 DSH 即可分组，插件不再产生 displayGroup；本次移除已无使用方的 model-display.patch，不应继续要求重建五个宿主包。
**Migration**: 使用已部署的 dsh-magpie-connector 多 route 实现，保留真实 provider/model 身份；选择器与目录回到官方 0.2.0-rc.2，按模型名搜索，不再保留 displayGroup 及按展示组标签搜索的宿主扩展。关联 magpie-owner-routes 的其余规范和发布任务仍由该 change 单独处理。

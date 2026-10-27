# plan.json 与 trails

计划只写待验内容，不保存 result/result_detail、trail status/blocked_reason。当前状态统一运行 status.py 计算。

## plan.json

```json
{
  "schema":1,
  "meta":{
    "feature":"settings-save","base_branch":"main","base_commit":"example-commit","created":"2026-01-01T00:00:00Z",
    "device":"pc","device_profile":null,
    "sources":{"openspec":true,"prd":false,"ui_specs":false,"figma":false,"git_diff":true},
    "mock":{"status":"none","evidence_count":0,"user_decision_required":false,"surface_scenario_matrix":[]},
    "execution_strategy":{"recommendation":"single_agent_recommended","reason":["共享页面"],"risks":[],"agent_assignments":[]},
    "external_doc_url":null,"oracle_freeze":null,"plan_revisions":[],"active_plan_rev":null
  },
  "manuals":[],
  "trails":[{"id":"T1","name":"保存设置","file":"trails/T1.json","device":"pc","parallel_group":"1","checkpoint_count":1,"summary":"保存后刷新回读"}]
}
```

schema/meta 的冻结及 revision 字段由脚本维护。不要手工给观察改 revision。trails 索引与磁盘全部 JSON 文件必须一一对应；checkpoint id 全局唯一。创建阶段1草案时可只有 meta，阶段3再补 trails。external_doc_url 是唯一外部文档字段，不读旧字段别名。

## trail

```json
{
  "id":"T1","name":"保存设置","description":"持久化设置","device":"pc","parallel_group":"1","conflicts_with":[],
  "precondition":"已登录","ask_user_if_blocked":true,
  "mock_setup":{"required":false,"status":"not_needed","scenario_id":null,"surface":"settings","data_source":null,"evidence":[],"enable":{"command":null,"env":null,"notes":null},"user_decision":null},
  "steps":[{"seq":1,"description":"保存后刷新回读","action":"click","target":"[data-testid='save']","value":null,"url_needs_input":false,
    "checkpoints":[{"id":"T1-S1-C1","description":"点击后提示成功且刷新后值保留","oracle_ids":["AC-1"],"origin":"oracle","focus":"interaction","verify":"assert_dom","automation":"full","expected_source":"spec","expected_unverified":false,"data_scenario_required":false,"surface":"settings","input_method":null,"selector":"[role='status']","expected_text":"保存成功","expected_visible":true}]}]
}
```

- origin=oracle 必须非空 oracle_ids，且全部存在于 oracle.json；derived 可为空，即使挂原 oracle 也不算原需求覆盖。
- focus=integration|interaction|visual；automation=full|partial|manual。
- action=navigate|click|fill|hover|press_key|wait_for；可交互步骤必须有后果断言，不只入口存在。
- mock_setup.status=not_needed|available|missing|unknown；available 要 evidence；依赖缺口需用户决定。checkpoint 显式 mock_status=missing|unknown 且自动化时，还需 mock_user_decision，不能被 trail 决定遮盖。
- 数据场景标 data_scenario_required/data_scenario/surface/data_source/mock_scenario_id；缺 surface 不能自动执行。
- 来源不明或实现推导期望为 expected_unverified=true，不计 pass。IME 用 manual，除非真实支持 composition。

## verify 专用字段

- assert_dom：selector、expected_text、expected_attrs、expected_visible。
- assert_network：expected_url、expected_method、expected_params、expected_status、expected_response。
- assert_url：expected_pattern。
- screenshot_compare：baseline、target_area；没有基准只能 partial/manual，不冒充精确视觉通过。
- visual_inspect：target_area、inspect_notes，结果 manual。

## 计划展示

从磁盘渲染表格供用户确认：trail/设备/group、前置、每个 step、checkpoint/focus/verify/automation、mock与URL待填项。不要求用户读原始 JSON。Reviewer 可先抽取一行/checkpoint 摘要，细节逐 trail 加载。--focus 不裁掉计划。

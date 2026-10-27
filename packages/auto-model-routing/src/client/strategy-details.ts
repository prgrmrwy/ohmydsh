import { createElement as h } from 'react'
import questions from '../policy-v2-rubric.json' with { type: 'json' }
import { registry } from '../strategies/index.js'

/** Read-only: criteria and slots are imported from the executable policy, never copied. */
export function StrategyDetails() {
  return h('details', { className: 'amr-strategy' },
    h('summary', { style: { cursor: 'pointer', padding: '8px 0' } }, '查看决策策略'),
    h('p', null, 'Agent 负责拆解、派发与验收；Jev 只做有限判断，AUTO 验证目录并应用资源配置。任务数量、风险和重要性不直接等于推理难度。以下为只读说明，不会修改设置。'),
    h('h4', null, '能力需求（仅子任务）'),
    h('p', null, 'bounded：方法明确、结果可验证的执行；analytical：需要调查、关联证据或选择方案；frontier：异常困难的原创推理或相互耦合的未知；insufficient_context：缺少目标或范围，停止并补充描述。'),
    h('h4', null, '推理投入（主会话与子任务分别判断）'),
    h('p', null, '主模型不变。以具体模型推荐投入为起点，lower / baseline / higher 分别在受支持序列中降低一档、保持、提高一档；受当前设置上限约束，自动不选 max。轻量模型不意味着自动降低投入。'),
    h('h4', null, '当前子模型能力映射'),
    ...registry.strategies.map(family => h('div', { key: family.id },
      h('strong', null, family.label),
      h('ul', null, ...Object.entries(family.childModels).map(([level, model]) => h('li', { key: level }, `${level} → ${model}（推荐起点 ${registry.effortStart(model) ?? '目录默认'}）`))))),
    h('p', null, `Magpie 保留对应家族前缀与真实 provider，不跨入口回退；模型与 effort 必须同时通过当前目录及官方允许列表校验。其他家族需显式指定模型及可验证投入。`),
    h('h4', null, '约束、失败与恢复'),
    h('p', null, '显式指定的模型与投入优先；两者都指定时只校验、不请求 Jev。目标不足、目录失效或子判断失败时停止派发，不偷偷继承或换模。主判断失败则可见停用 AUTO。fresh 子任务创建时绑定精确身份；后续消息和恢复不重新选模。fork 暂不支持。MANUAL 停止新判断，已有绑定子任务仍保持初始路线。'),
    h('h4', null, 'Jev 实际判据原文'),
    h('p', null, '下面直接展示执行中使用的英文规则，避免翻译改变含义；两个问题相互独立，不能读取对方答案。'),
    ...Object.entries(questions).map(([dimension, question]) => h('section', { key: dimension, style: { overflowWrap: 'anywhere' } },
      h('strong', null, dimension), h('p', null, question.instructions),
      h('dl', null, ...Object.entries(question.criteria).flatMap(([label, criterion]) => [h('dt', { key: `${label}-label` }, h('strong', null, label)), h('dd', { key: label, style: { margin: '4px 0 12px 12px' } }, criterion)])))),
  )
}

import { createElement as h } from 'react'
import questions from '../rubric.json' with { type: 'json' }
import { registry } from '../strategies/index.js'
import { t } from './locales.js'

/** Read-only: criteria and slots are imported from the executable policy, never copied. */
export function StrategyDetails() {
  return h('details', { className: 'amr-strategy' },
    h('summary', { style: { cursor: 'pointer', padding: '8px 0' } }, t('strategySummary')),
    h('p', null, t('strategyIntro')),
    h('h4', null, t('strategyCapability')),
    h('p', null, t('strategyCapabilityBody')),
    h('h4', null, t('strategyDepth')),
    h('p', null, t('strategyDepthBody')),
    h('h4', null, t('strategyFamilies')),
    ...registry.strategies.map(family => h('div', { key: family.id },
      h('strong', null, family.label),
      h('ul', null, ...Object.entries(family.childModels).map(([level, model]) => h('li', { key: level }, t('strategyFamilyItem', { level, model, start: registry.effortStart(model) ?? t('strategyCatalogDefault') })))))),
    h('p', null, t('strategyTrailer')),
    h('h4', null, t('strategyLimits')),
    h('p', null, t('strategyLimitsBody')),
    h('h4', null, t('strategyRules')),
    h('p', null, t('strategyRulesBody')),
    ...Object.entries(questions).map(([dimension, question]) => h('section', { key: dimension, style: { overflowWrap: 'anywhere' } },
      h('strong', null, dimension), h('p', null, question.instructions),
      h('dl', null, ...Object.entries(question.criteria).flatMap(([label, criterion]) => [h('dt', { key: `${label}-label` }, h('strong', null, label)), h('dd', { key: label, style: { margin: '4px 0 12px 12px' } }, criterion)])))),
  )
}

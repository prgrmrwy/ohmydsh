import { createElement as h } from 'react'
import { resolvePreset, type Localized, type Preset } from '../presets/index.js'
import { registry } from '../strategies/index.js'
import { t } from './locales.js'

/** Read-only: criteria and slots are imported from the executable policy, never copied. */
/** The visible half of a preset's bilingual metadata. */
export const localized = (text: Localized) => t('presetLang') === 'en' ? text.en : text.zh

export function StrategyDetails({ preset = resolvePreset(undefined) }: { preset?: Preset }) {
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
    h('h4', null, t('strategyPreset')),
    h('p', null, h('strong', null, localized(preset.title)), ` (${preset.id})`),
    h('p', null, localized(preset.summary)),
    h('p', null, `${t('strategyEvidence')}: ${localized(preset.evidence)}`),
    h('p', null, `${t('strategySources')}: `, ...preset.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { key: s.url, href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title), ` (${s.date})`])),
    h('h4', null, t('strategyRules')),
    h('p', null, t('strategyRulesBody')),
    ...(['capability', 'depth'] as const).map(dimension => [dimension, preset.rubric[dimension]] as const).map(([dimension, question]) => h('section', { key: dimension, style: { overflowWrap: 'anywhere' } },
      h('strong', null, dimension), h('p', null, question.instructions),
      h('dl', null, ...Object.entries(question.criteria).flatMap(([label, criterion]) => [h('dt', { key: `${label}-label` }, h('strong', null, label)), h('dd', { key: label, style: { margin: '4px 0 12px 12px' } }, criterion)])))),
  )
}

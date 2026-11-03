import type * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** Shell-owned primitives are injected so DOM tests exercise draft behavior independently. */
export type SettingsUi = Pick<typeof Primitives,
  'Menu' | 'SettingsForm' | 'SettingsSecretField' | 'SegmentedTabs' | 'SegmentedControl' | 'Switch' | 'Tag' | 'Tooltip' |
  'IconInfoOutlineRegular' | 'IconChevronDownOutlineRegular' | 'IconChevronLeftOutlineRegular' |
  'IconChevronRightOutlineRegular' | 'IconCheckOutlineRegular' | 'MenuSurface' | 'MenuGroup' |
  'useAnchoredPosition' | 'focusWithoutRing'>

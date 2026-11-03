// The web shell provides @deepseek-ai/dsh-client-ui-primitives at runtime; tests never load the real
// bundle (it imports CSS modules). Icons render as assertable svg placeholders and Tooltip is transparent.
import { createElement } from 'react'
const icon = (name: string) => () => createElement('svg', { 'data-icon': name, width: 14, height: 14, viewBox: '0 0 16 16' })
export const IconTriangleRightFillRegular = icon('triangle-right-fill')
export const IconChevronUpOutlineRegular = icon('chevron-up')
export const IconChevronDownOutlineRegular = icon('chevron-down')
export const IconTrashOutlineRegular = icon('trash')
export const Tooltip = ({ children }: { children: unknown }) => children
// Anchored placement and outside-pointer dismissal are pure browser geometry; jsdom has no layout,
// so the stub reports "not measured yet" and never dismisses. Components must tolerate both.
export const useAnchoredPosition = (): null => null
export const useDismissOnOutsidePointer = (): void => {}

/** Minimal Navigation API typings (not in lib.dom of the pinned TypeScript). */
export interface NavEntry {
  readonly key: string
  readonly url: string | null
}
export interface NavDestination {
  readonly url: string
  readonly sameDocument: boolean
}
export interface NavigateEventLike extends Event {
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse'
  readonly destination: NavDestination
  readonly cancelable: boolean
  readonly formData: FormData | null
  readonly sourceElement: Element | null
}
export interface NavigationLike extends EventTarget {
  readonly currentEntry: NavEntry | null
  entries(): NavEntry[]
  navigate(url: string, options?: { history?: 'auto' | 'push' | 'replace' }): unknown
}

/**
 * Launcher presentation: the page a browse click lands on.
 *
 * Kept as plain DOM rather than a settings slot because this tab is opened
 * standalone — there is no settings shell around it, and the whole viewport
 * belongs to one message. It mounts only when the hash names a launcher route,
 * so an ordinary DSH tab is untouched.
 *
 * @module dsh-memex/client/launcher-view
 */
import { launcherScope, runLauncher, type LauncherDeps } from './launcher.js'

/** Only the keys this view renders, so the caller's typed binder still fits. */
export type LauncherTranslate = (
  key: 'browseOpening' | 'browseRedirecting' | 'browseUnavailable',
  params?: Record<string, string>,
) => string

export interface LauncherViewOptions {
  readonly deps: LauncherDeps
  /** Localized strings; the caller owns the dictionary. */
  readonly t: LauncherTranslate
  /** Navigation seam, overridable in tests. */
  readonly navigate?: (address: string) => void
}

/**
 * Mount the launcher when the current hash asks for it.
 * @returns a disposer; harmless when nothing was mounted.
 */
export function mountLauncher(options: LauncherViewOptions): () => void {
  let host: HTMLElement | undefined
  /** Library the mounted view belongs to; `undefined` when nothing is mounted. */
  let mountedScope: string | undefined
  /** Incremented per render so a superseded resolution cannot paint. */
  let generation = 0

  const render = (): void => {
    const scope = launcherScope(window.location.hash)
    if (scope === undefined) {
      host?.remove()
      host = undefined
      mountedScope = undefined
      return
    }
    // Re-render whenever the TARGET changes, not merely when nothing is
    // mounted. Guarding on "a host exists" alone made a second library open
    // inside the first one's view: the hash had changed but the page kept
    // showing — and kept resolving — the library it was first mounted for.
    if (host !== undefined && mountedScope === scope) return

    host?.remove()
    const current = ++generation

    host = document.createElement('div')
    mountedScope = scope
    host.setAttribute('data-dsh-memex-launcher', scope)
    host.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'display:flex', 'flex-direction:column', 'gap:12px',
      'align-items:center', 'justify-content:center',
      'padding:32px', 'text-align:center',
      'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'background:var(--dsh-bg-layer-1,#111)', 'color:var(--dsh-text-primary,#eee)',
    ].join(';')

    const title = document.createElement('div')
    title.style.cssText = 'font-size:15px;font-weight:600'
    title.textContent = options.t('browseOpening', { scope })

    const detail = document.createElement('div')
    detail.style.cssText = 'max-width:60ch;opacity:.8;white-space:pre-wrap'

    host.append(title, detail)
    document.body.appendChild(host)

    void runLauncher(scope, options.deps).then(outcome => {
      // Starting a service takes a moment, so the user can retarget this tab
      // before the answer lands. A superseded resolution must not paint over
      // the newer view — and must never navigate, which would send the tab to
      // the library the user just moved away from.
      if (current !== generation) return

      if (outcome.status === 'ready' && outcome.address !== undefined) {
        title.textContent = options.t('browseRedirecting', { scope })
        const navigate = options.navigate ?? ((address: string) => { window.location.replace(address) })
        navigate(outcome.address)
        return
      }
      // Failure stays on this page with the reason in full: a blocked popup or
      // a silent navigation to nowhere is exactly what this view prevents.
      title.textContent = options.t('browseUnavailable', { scope })
      detail.textContent = outcome.message ?? ''
    })
  }

  render()
  window.addEventListener('hashchange', render)
  return () => {
    window.removeEventListener('hashchange', render)
    // Bump the generation so an in-flight resolution cannot navigate a tab
    // whose launcher has already been disposed.
    generation += 1
    host?.remove()
    host = undefined
    mountedScope = undefined
  }
}

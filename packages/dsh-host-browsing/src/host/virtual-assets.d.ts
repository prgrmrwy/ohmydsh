/**
 * Browser-side scripts bundled to minified IIFEs at build time and inlined into
 * the Host bundle as text (see tsdown.config.ts → dshlsAssetsPlugin).
 */
declare module 'virtual:dshls/inject' {
  /** Text of the injected page script (reads `globalThis[INJECT_CONFIG_GLOBAL]`). */
  const source: string
  export default source
}
declare module 'virtual:dshls/sw' {
  /** Text of the plugin Service Worker script served at SW_SCRIPT. */
  const source: string
  export default source
}

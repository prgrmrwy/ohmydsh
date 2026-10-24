// Evidence ledger validator, not a substitute for running the platform gates.
export function acceptanceStatus(report) {
  const missing = []
  for (const platform of ['linux', 'win32', 'darwin']) {
    for (const check of ['contracts', 'terminalClose', 'buildFirst', 'buildSecondNoop', 'dump', 'hostReady', 'hostStop']) {
      if (report?.[platform]?.[check] !== true) missing.push(`${platform}.${check}`)
    }
  }
  return { complete: missing.length === 0, fullWindowsSupport: missing.length === 0, missing }
}

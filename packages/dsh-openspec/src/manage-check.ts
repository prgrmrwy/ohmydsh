function parse(v: string) { const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null }
function cmp(a: string, b: string) { const x = parse(a), y = parse(b); if (!x || !y) return NaN; for (let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]!<y[i]!?-1:1; return 0 }
export function checkManagedCli(input: { pathVersion: string | null; managedVersion: string; nodeVersion: string | null; engine: string; recovery?: string; skills?: Array<{ name: string; source: string; provider: string }> }) {
  const match = input.engine.match(/^>=?(\d+)\.(\d+)\.(\d+)$/)
  // `nodeVersion` is the node found on the session Bash PATH. When it cannot be determined the support
  // is reported as `unknown` rather than being inferred from the Host process, which may differ.
  const nodeSupported: boolean | 'unknown' = input.nodeVersion === null ? 'unknown' : Boolean(match && cmp(input.nodeVersion, `${match[1]}.${match[2]}.${match[3]}`) >= 0)
  return {
    pathVersion: input.pathVersion ?? 'not-found', managedVersion: input.managedVersion,
    mismatch: input.pathVersion !== null && input.pathVersion !== input.managedVersion,
    nodeSupported, bashNodeVersion: input.nodeVersion ?? 'unknown', recovery: input.recovery ?? 'none',
    skillWinners: (input.skills ?? []).map(({ name, source, provider }) => ({ name, source, provider })),
  }
}
/** Winning source/provider as seen by ONE caller: the registry resolves precedence per workspace and scope. */
export async function diagnoseSkillWinners(skills: { list: (options?: any) => Promise<Array<{ name: string; source: string; provider: string }>> }, names: string[], caller: { cwd?: string; scope?: object } = {}) {
  const summaries = await skills.list({ ...(caller.cwd ? { cwd: caller.cwd } : {}), ...(caller.scope ? { scope: caller.scope } : {}) })
  const requested = new Set(names)
  return summaries.filter((skill) => requested.has(skill.name)).map(({ name, source, provider }) => ({ name, source, provider }))
}

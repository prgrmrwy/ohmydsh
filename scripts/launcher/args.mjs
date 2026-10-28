const OFFICIAL = /^(?:--profile|--patch)(?:=|$)|^--dump-(?:default-)?config$/
export function isOfficialInvocation(argv) {
  return argv.some(arg => OFFICIAL.test(arg)) || argv.find(arg => !arg.startsWith('-')) === 'plugin'
}

export function parseArgs(argv) {
  const flags = { port: undefined, portExplicit: false, passthrough: [] }
  const commandFlags = { build: 'buildOnly', stop: 'stop', restart: 'restart', reset: 'reset', history: 'history', doctor: 'doctor', 'plugin-update': 'pluginUpdate' }
  const options = { '-b': 'build', '--build': 'build', '--foreground': 'foreground', '--open': 'open', '--no-open': 'noOpen', '--check': 'check', '--dry-run': 'dryRun', '-y': 'yes', '--yes': 'yes', '-h': 'help', '--help': 'help' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (commandFlags[arg]) flags[commandFlags[arg]] = true
    else if (options[arg]) flags[options[arg]] = true
    else if (['web', '-d', '--daemon'].includes(arg)) continue
    else if (['-p', '--port', '--host', '--trusted-host'].includes(arg)) {
      const value = argv[++index]
      if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`参数 ${arg} requires a value`)
      if (arg === '-p' || arg === '--port') { flags.port = value; flags.portExplicit = true }
      else flags.passthrough.push(arg, value)
    } else if (arg.startsWith('--port=')) { flags.port = arg.slice(7); flags.portExplicit = true }
    else if (/^--(?:host|trusted-host)=/.test(arg)) {
      if (arg.endsWith('=')) throw new Error(`参数 ${arg.split('=')[0]} requires a value`)
      flags.passthrough.push(arg)
    } else throw new Error(`无法识别的参数 '${arg}'; see dsh --help`)
  }
  if (flags.port !== undefined && (!/^\d+$/.test(String(flags.port)) || Number(flags.port) < 1 || Number(flags.port) > 65535)) throw new Error('参数 --port must be an integer in 1..65535')
  if (flags.port !== undefined) flags.port = Number(flags.port)
  if (flags.check && !flags.doctor) throw new Error('--check 只能与 doctor 一起使用')
  return flags
}

// bare host[:port]:主机名/IPv4,或带方括号的 IPv6;官方 connection 加载时仍会再严格校验规范形式。
const AUTHORITY = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

/**
 * 本机私有 `DSH_TRUSTED_HOSTS`(通常写在 gitignored 的 .env.local,逗号或空白分隔)
 * → 官方 `--trusted-host` 参数。域名属于部署事实,不进公开 manifest。
 * 写错时抛错而不是忽略:静默丢弃会让入口 403,静默放宽则扩大 Host fence;
 * 调用方须在停止现有 Host 之前调用,避免官方启动时才报错导致起不来。
 */
export function trustedHostArgs(env) {
  const raw = env?.DSH_TRUSTED_HOSTS
  if (raw === undefined || raw.trim() === '') return []
  const hosts = raw.split(/[\s,]+/).filter(Boolean)
  const invalid = hosts.find(host => !AUTHORITY.test(host))
  if (invalid !== undefined) throw new Error(`DSH_TRUSTED_HOSTS entry ${JSON.stringify(invalid)} is not a bare host[:port] authority`)
  return hosts.flatMap(host => ['--trusted-host', host])
}

export const HELP = `ohmydsh — customization repository launcher

Usage: dsh [web] [options]
  build | -b                 build only, or build before start
  stop | restart             safely stop/restart the owned Host
  reset                      reset managed customizations
  history                    show last twenty startup records
  doctor [--check]            heal/check machine prerequisites
  plugin-update [--dry-run] [--yes]
  --foreground               wait for Host and propagate its status
  -p, --port <1..65535>       override DSH_PORT (default 3080); previews auto-backoff unless explicit
  --open | --no-open         override manifest UI opening
  --host <host> --trusted-host <host>
  plugin / --profile / --patch / --dump-config are forwarded to the pinned official CLI

Initialize: node scripts/bootstrap.mjs; then npm link (no forced bin overwrite).
`

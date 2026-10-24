const OFFICIAL = /^(?:--profile|--patch)(?:=|$)|^--dump-(?:default-)?config$/
export function isOfficialInvocation(argv) {
  return argv.some(arg => OFFICIAL.test(arg)) || argv.find(arg => !arg.startsWith('-')) === 'plugin'
}

export function parseArgs(argv) {
  const flags = { port: 3080, passthrough: [] }
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
      if (arg === '-p' || arg === '--port') flags.port = value
      else flags.passthrough.push(arg, value)
    } else if (arg.startsWith('--port=')) flags.port = arg.slice(7)
    else if (/^--(?:host|trusted-host)=/.test(arg)) {
      if (arg.endsWith('=')) throw new Error(`参数 ${arg.split('=')[0]} requires a value`)
      flags.passthrough.push(arg)
    } else throw new Error(`无法识别的参数 '${arg}'; see dsh --help`)
  }
  if (!/^\d+$/.test(String(flags.port)) || Number(flags.port) < 1 || Number(flags.port) > 65535) throw new Error('参数 --port must be an integer in 1..65535')
  flags.port = Number(flags.port)
  if (flags.check && !flags.doctor) throw new Error('--check 只能与 doctor 一起使用')
  return flags
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
  -p, --port <1..65535>       default 3080
  --open | --no-open         override manifest UI opening
  --host <host> --trusted-host <host>
  plugin / --profile / --patch / --dump-config are forwarded to the pinned official CLI

Initialize: node scripts/bootstrap.mjs; then npm link (no forced bin overwrite).
`

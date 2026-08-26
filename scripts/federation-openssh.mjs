const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function assertSshAlias(alias) {
  if (!SAFE_ALIAS.test(alias) || alias.startsWith('-')) {
    throw new Error('invalid SSH alias')
  }
  return alias
}

export function identityProbeArgs({ configFile, alias, connectTimeoutSeconds = 5 }) {
  return [
    '-F', configFile,
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '--', assertSshAlias(alias),
    'true',
  ]
}

export function tunnelArgs({ configFile, alias, localPort, remotePort }) {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) throw new Error('invalid local port')
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new Error('invalid remote port')
  return [
    '-F', configFile,
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    '--', assertSshAlias(alias),
  ]
}

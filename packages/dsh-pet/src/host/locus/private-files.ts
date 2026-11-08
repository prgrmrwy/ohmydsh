/** Pet-local private filesystem boundary; this module ships with standalone Pet. */
import { execFile } from 'node:child_process'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import { join, win32 } from 'node:path'

export const PRIVATE_FILE_MAX_BYTES = 64 * 1024
export const PRIVATE_READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

function unsafe(): never { throw new Error('Unsafe stop descriptor filesystem boundary') }
function owner(stat: Stats): boolean { return process.getuid === undefined || stat.uid === process.getuid() }
export function samePrivateIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}
export function assertPrivateFile(stat: Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > PRIVATE_FILE_MAX_BYTES ||
      (process.platform !== 'win32' && (!owner(stat) || (stat.mode & 0o777) !== 0o600))) unsafe()
}
function assertDirectory(stat: Stats, run: boolean): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (process.platform !== 'win32' && (!owner(stat) || (run ? (stat.mode & 0o022) !== 0 : (stat.mode & 0o777) !== 0o700)))) unsafe()
}

export interface PrivateBoundary {
  readonly run: string
  readonly directory: string
  readonly runStat: Stats
  readonly directoryStat: Stats
}

/** Validate ancestors before touching their children, including independent Pet entry. */
export async function stopPrivateBoundary(root: string, create = false): Promise<PrivateBoundary> {
  const run = join(root, 'run')
  const directory = join(run, 'dsh-pet-stop')
  if (process.platform === 'win32') {
    await windowsPrivateFiles(create ? 'ensure' : 'verify', [
      { path: run, kind: 'run' }, { path: directory, kind: 'directory' },
    ])
  } else if (create) {
    await mkdir(run, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  }
  const runStat = await lstat(run)
  assertDirectory(runStat, true)
  if (process.platform !== 'win32' && create) {
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
  }
  const directoryStat = await lstat(directory)
  assertDirectory(directoryStat, false)
  return { run, directory, runStat, directoryStat }
}

/** Recheck the exact parent identities after asynchronous filesystem operations. */
export async function verifyPrivateBoundary(boundary: PrivateBoundary, files: readonly string[] = []): Promise<void> {
  if (process.platform === 'win32') {
    await windowsPrivateFiles('verify', [
      { path: boundary.run, kind: 'run' }, { path: boundary.directory, kind: 'directory' },
      ...files.map(path => ({ path, kind: 'file' as const })),
    ])
  }
  await verifyPrivateBoundaryIdentity(boundary, files)
}

/** The native ACL check is batched separately; retain Node path identity checks. */
export async function verifyPrivateBoundaryIdentity(boundary: PrivateBoundary, files: readonly string[] = []): Promise<void> {
  const run = await lstat(boundary.run)
  assertDirectory(run, true)
  if (!samePrivateIdentity(run, boundary.runStat)) unsafe()
  const directory = await lstat(boundary.directory)
  assertDirectory(directory, false)
  if (!samePrivateIdentity(directory, boundary.directoryStat)) unsafe()
  for (const file of files) assertPrivateFile(await lstat(file))
}

/** Only a newly wx-created file in an already verified parent can be secured. */
export async function secureCreatedPrivateFile(boundary: PrivateBoundary, path: string): Promise<void> {
  if (process.platform === 'win32') {
    await windowsPrivateFiles('secure-file', [
      { path: boundary.run, kind: 'run' }, { path: boundary.directory, kind: 'directory' },
      { path, kind: 'file' },
    ])
  }
  await verifyPrivateBoundaryIdentity(boundary)
  assertPrivateFile(await lstat(path))
}

interface WindowsEntry { readonly path: string; readonly kind: 'run' | 'directory' | 'file' }
async function windowsPrivateFiles(action: 'ensure' | 'verify' | 'secure-file', entries: readonly WindowsEntry[]): Promise<void> {
  const root = process.env.SystemRoot
  if (!root || !win32.isAbsolute(root)) unsafe()
  const executable = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const paths = (action === 'secure-file' ? entries.filter(entry => entry.kind === 'file') : entries)
    .map(entry => ({ path: entry.path, type: entry.kind === 'file' ? 'file' : 'directory' }))
  const input = JSON.stringify({ action: action === 'verify' ? 'assert' : action === 'secure-file' ? 'secure-new-file' : 'ensure', paths })
  if (Buffer.byteLength(input) > 64 * 1024) unsafe()
  await new Promise<void>((resolve, reject) => {
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PRIVATE_SCRIPT, 'utf16le').toString('base64')], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      let response: { ok?: unknown; missing?: unknown } | null
      try { response = JSON.parse(stdout) as typeof response } catch { reject(new Error('Unsafe stop descriptor filesystem boundary')); return }
      if (error !== null || response?.ok !== true) {
        const failure: NodeJS.ErrnoException = new Error('Unsafe stop descriptor filesystem boundary')
        // Only the fixed script's explicit not-found report means absence.
        if (error !== null && error.code === 1 && !error.killed && !error.signal && response?.ok === false && response.missing === true) failure.code = 'ENOENT'
        reject(failure)
      } else resolve()
    })
    // stdin contains paths/actions only; no descriptor or authentication material.
    child.stdin?.on('error', () => { /* execFile reports tool failure through its callback. */ })
    child.stdin?.end(input)
  })
}

// Keep this fixed source identical to the launcher; no runtime repository import.
export const WINDOWS_PRIVATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$missing = $false
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $user = $identity.User
  $admin = [System.Security.Principal.WindowsPrincipal]::new($identity).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  $allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  function Attributes([string] $p) {
    try { return [System.IO.File]::GetAttributes($p) }
    catch {
      $cause = $_.Exception
      while ($cause.InnerException) { $cause = $cause.InnerException }
      if ($cause -is [System.IO.FileNotFoundException] -or $cause -is [System.IO.DirectoryNotFoundException]) { $script:missing = $true }
      throw
    }
  }
  function Check-Type([string] $p, [string] $type) {
    $attributes = Attributes $p
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse point' }
    $directory = ($attributes -band [System.IO.FileAttributes]::Directory) -ne 0
    if (($type -eq 'directory') -ne $directory) { throw 'wrong type' }
  }
  function Check-Private([string] $p, [string] $type) {
    Check-Type $p $type
    $sections = [System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access
    if ($type -eq 'directory') { $acl = [System.IO.Directory]::GetAccessControl($p, $sections) }
    else { $acl = [System.IO.File]::GetAccessControl($p, $sections) }
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $user.Value -and -not ($admin -and $owner -eq 'S-1-5-32-544')) { throw 'wrong owner' }
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if (($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -eq 0 -or $null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -eq 0) { throw 'missing DACL' }
    foreach ($ace in $raw.DiscretionaryAcl) {
      # Only ordinary, non-callback file allow/deny ACEs are understood. Inspect
      # raw ACEs so object/callback/unknown rules cannot disappear in conversion.
      if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback -or ([int]$ace.AceFlags -band (-bnot 31)) -ne 0) { throw 'unsupported ACE' }
      if ($ace.AceType -ne [System.Security.AccessControl.AceType]::AccessAllowed -and $ace.AceType -ne [System.Security.AccessControl.AceType]::AccessDenied) { throw 'unsupported ACE type' }
      if (([int]$ace.AccessMask -band (-bnot 2032127)) -ne 0) { throw 'unsupported access rights' }
      if ($ace.AceType -eq [System.Security.AccessControl.AceType]::AccessAllowed -and $allowed -notcontains $ace.SecurityIdentifier.Value) { throw 'non-private allow ACE' }
    }
  }
  function Private-Security([bool] $directory) {
    if ($directory) {
      $security = New-Object System.Security.AccessControl.DirectorySecurity
      $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
      $security = New-Object System.Security.AccessControl.FileSecurity
      $inherit = [System.Security.AccessControl.InheritanceFlags]::None
    }
    $security.SetOwner($user)
    $security.SetAccessRuleProtection($true, $false)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($user, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
    return $security
  }
  function Ensure-Directory([string] $p) {
    # Directory.Exists also returns false on errors. Only an actual not-found
    # exception permits creation; access/query failures remain fatal.
    try { $null = Attributes $p }
    catch {
      if (-not $script:missing) { throw }
      $script:missing = $false
      $parent = [System.IO.Path]::GetDirectoryName($p)
      if (-not $parent -or $parent -eq $p) { throw 'missing root' }
      try { Check-Type $parent 'directory' }
      catch {
        if (-not $script:missing) { throw }
        $script:missing = $false
        Ensure-Directory $parent
      }
      $null = [System.IO.Directory]::CreateDirectory($p, (Private-Security $true))
    }
    # Existing directories are never passed to SetAccessControl.
    Check-Private $p 'directory'
  }
  if ($request.action -eq 'ensure') {
    foreach ($entry in $request.paths) { Ensure-Directory $entry.path }
  } elseif ($request.action -eq 'assert') {
    foreach ($entry in $request.paths) { Check-Private $entry.path $entry.type }
  } elseif ($request.action -eq 'secure-new-file' -and $request.paths.Count -eq 1) {
    $p = [string]$request.paths[0].path
    Check-Private ([System.IO.Path]::GetDirectoryName($p)) 'directory'
    Check-Type $p 'file'
    [System.IO.File]::SetAccessControl($p, (Private-Security $false))
    Check-Private $p 'file'
  } else { throw 'unknown operation' }
  [Console]::Out.Write('{"ok":true}')
} catch {
  if ($missing) { [Console]::Out.Write('{"ok":false,"missing":true}') }
  else { [Console]::Out.Write('{"ok":false,"missing":false}') }
  exit 1
}
`

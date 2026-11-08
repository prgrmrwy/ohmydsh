import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const unsafe = () => new Error('unsafe private filesystem boundary')
const owned = stat => process.getuid === undefined || stat.uid === process.getuid()

// Fixed PowerShell 5.1 program. All variable data travels only in stdin JSON.
// Keep the independently packaged Pet implementation on this same ACL contract.
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

function windows(action, paths) {
  const root = process.env.SystemRoot
  if (!root || !path.win32.isAbsolute(root)) throw unsafe()
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const input = JSON.stringify({ action, paths })
  if (Buffer.byteLength(input) > 64 * 1024) throw unsafe()
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PRIVATE_SCRIPT, 'utf16le').toString('base64')], {
    shell: false, windowsHide: true, input, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
  })
  let response
  try { response = JSON.parse(result.stdout) } catch { throw unsafe() }
  if (result.error || result.signal || result.status !== 0 || response?.ok !== true) {
    const error = unsafe()
    // Only the script's explicit filesystem not-found result is absence.
    if (!result.error && !result.signal && result.status === 1 && response?.ok === false && response.missing === true) error.code = 'ENOENT'
    throw error
  }
}

function posixAssert({ path: target, type, exact = true }) {
  const stat = fs.lstatSync(target)
  const mode = type === 'directory' ? 0o700 : 0o600
  if (stat.isSymbolicLink() || !(type === 'directory' ? stat.isDirectory() : stat.isFile()) || !owned(stat) || (exact ? (stat.mode & 0o777) !== mode : (stat.mode & 0o022) !== 0)) throw unsafe()
}

export function ensurePrivateDirectories(paths) {
  if (process.platform === 'win32') return windows('ensure', paths)
  for (const entry of paths) {
    fs.mkdirSync(entry.path, { recursive: true, mode: 0o700 })
    posixAssert({ ...entry, type: 'directory' })
  }
}

export function assertPrivatePaths(paths) {
  if (process.platform === 'win32') return windows('assert', paths)
  for (const entry of paths) posixAssert(entry)
}

// Only use for a trusted wx-created temporary file, before publication. Existing
// published files must pass assertPrivatePaths and must never be repaired.
export function secureNewPrivateFile(file) {
  if (process.platform === 'win32') return windows('secure-new-file', [{ path: file }])
  assertPrivatePaths([{ path: path.dirname(file), type: 'directory' }, { path: file, type: 'file' }])
}

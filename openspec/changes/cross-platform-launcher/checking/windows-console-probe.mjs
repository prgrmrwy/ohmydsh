// Inert console experiment: no launcher or Host, no recursive tree termination.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
if (process.platform !== 'win32') throw Error('Native Windows required')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'console-close-probe-'))
const script = path.join(root, 'console.ps1')
await fs.writeFile(script, String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.IO;using System.Runtime.InteropServices;
public static class ProbeConsole {
 public delegate bool Handler(uint kind);static Handler handler;
 [DllImport("kernel32.dll")]static extern bool FreeConsole();
 [DllImport("kernel32.dll")]static extern bool AllocConsole();
 [DllImport("kernel32.dll")]static extern IntPtr GetConsoleWindow();
 [DllImport("kernel32.dll")]static extern bool SetConsoleCtrlHandler(Handler h,bool add);
 public static void Open(){if(Environment.GetEnvironmentVariable("PROBE_CLASSIC")!="1"){FreeConsole();if(!AllocConsole())throw new Exception("AllocConsole failed");}handler=delegate(uint k){File.WriteAllText(Environment.GetEnvironmentVariable("PROBE_EVENT"),k.ToString());return false;};if(!SetConsoleCtrlHandler(handler,true))throw new Exception("SetConsoleCtrlHandler failed");File.WriteAllText(Environment.GetEnvironmentVariable("PROBE_HWND"),GetConsoleWindow().ToInt64().ToString());}
}
'@
[ProbeConsole]::Open()
while($true){Start-Sleep -Milliseconds 100}
`)
const ps = text => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 8000 })
for (const mode of ['WM_CLOSE', 'SC_CLOSE']) {
 const handle = path.join(root, mode + '.hwnd'), event = path.join(root, mode + '.event')
 const child = spawn(process.argv.includes('--classic') ? 'conhost.exe' : 'powershell.exe', [...(process.argv.includes('--classic') ? ['powershell.exe'] : []), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { env: { ...process.env, PROBE_HWND: handle, PROBE_EVENT: event, PROBE_CLASSIC: process.argv.includes('--classic') ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false })
 let stderr = '';child.stderr.on('data', b => stderr += b);child.stdout.resume()
 try {
  let hwnd;const deadline = Date.now() + 15000
  while (Date.now() < deadline && child.exitCode === null) { hwnd = await fs.readFile(handle, 'utf8').catch(() => '');if (hwnd) break;await new Promise(r => setTimeout(r, 100)) }
  if (!/^[1-9][0-9]*$/.test(hwnd || '')) throw Error('No HWND: ' + stderr)
  const csharp = 'using System;using System.Text;using System.Runtime.InteropServices;public class ProbeWindow{[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder b,int n);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}'
  const sent = ps(`Add-Type -TypeDefinition '${csharp}';$h=[IntPtr]::new([long]${hwnd});[uint32]$owner=0;$thread=[ProbeWindow]::GetWindowThreadProcessId($h,[ref]$owner);$b=New-Object System.Text.StringBuilder 256;[void][ProbeWindow]::GetClassName($h,$b,256);$ok=[ProbeWindow]::PostMessage($h,${mode === 'WM_CLOSE' ? '0x10,[IntPtr]::Zero' : '0x112,[IntPtr]::new(0xf060)'},[IntPtr]::Zero);[pscustomobject]@{Visible=[ProbeWindow]::IsWindowVisible($h);Class=$b.ToString();WindowOwner=$owner;OwnerName=(Get-Process -Id $owner).ProcessName;Sent=$ok}|ConvertTo-Json -Compress`)
  if (sent.status !== 0) throw Error(sent.stderr)
  const until = Date.now() + 8000
  while (Date.now() < until && child.exitCode === null) await new Promise(r => setTimeout(r, 100))
  console.log(JSON.stringify({ mode, childPid: child.pid, window: JSON.parse(sent.stdout), exitCode: child.exitCode, signal: child.signalCode, event: await fs.readFile(event, 'utf8').catch(() => '<absent>'), stderr }))
 } finally { if (child.exitCode === null && child.signalCode === null) child.kill() }
}
console.log(JSON.stringify({ evidence: root }))

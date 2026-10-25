import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, cp, symlink, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { probePort, stopServer } from '../../scripts/launcher/process.mjs'
const ROOT=path.resolve(import.meta.dirname,'../..')

export async function terminalFixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'ohmydsh terminal 中文 '))
  const home=path.join(root,'home')
  const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port))})})
  await mkdir(path.join(root,'bin'),{recursive:true})
  await cp(path.join(ROOT,'bin/dsh.mjs'),path.join(root,'bin/dsh.mjs'))
  await cp(path.join(ROOT,'scripts'),path.join(root,'scripts'),{recursive:true})
  await writeFile(path.join(root,'package.json'),'{"type":"module"}')
  await cp(path.join(ROOT,'package-lock.json'),path.join(root,'package-lock.json'))
  if(process.platform==='win32'){
    for(const name of ['zx','js-yaml','argparse','yaml','semver','typescript'])await cp(path.join(ROOT,'node_modules',name),path.join(root,'node_modules',name),{recursive:true,dereference:true})
  }else await symlink(path.join(ROOT,'node_modules'),path.join(root,'node_modules'),'dir')
  await writeFile(path.join(root,'dsh.yaml'),'dshVersion: 0.2.0-rc.2\nautoUpdate:\n  enabled: false\nweb:\n  open: false\ncustomizations: []\n')
  const pkg=path.join(root,'runtime/node_modules/@deepseek-ai/dsh')
  const bin=path.join(pkg,'lib/bin.js')
  await mkdir(path.dirname(bin),{recursive:true})
  await writeFile(path.join(pkg,'package.json'),'{"name":"@deepseek-ai/dsh","version":"0.2.0-rc.2","type":"module"}')
  await writeFile(bin,"import net from 'node:net';net.createServer(socket=>socket.end()).listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1')")
  await writeFile(path.join(root,'scripts/dsh-server-bin.mjs'),`console.log('DSH_SERVER_BIN='+${JSON.stringify(bin)});console.log('DSH_RUNTIME_KIND=npx-cache')`)
  await writeFile(path.join(root,'scripts/check-update.mjs'),"console.log(JSON.stringify({enabled:false,status:'no-update'}))")
  await writeFile(path.join(root,'scripts/host-prerequisites.mjs'),'process.exit(0)')
  await writeFile(path.join(root,'scripts/plugin-list.mjs'),"console.log('fixture-plugin')")
  t.after(async()=>{
    const current=await probePort(port)
    if(current.state==='owned'&&current.processes.every(item=>item.argv?.[1]===bin)){
      const stopped=await stopServer(port)
      if(!stopped.ok)throw new Error('Owned terminal fixture Host could not stop: '+stopped.error)
    }else if(current.state!=='empty')throw new Error('Refusing cleanup of a terminal fixture port with unknown ownership')
    await rm(root,{recursive:true,force:true})
  })
  const baseEnv=process.platform==='win32'?Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:SystemRoot|ComSpec|PATH|TEMP|TMP|WINDIR)$/i.test(key))):process.env
  return {root,home,port,bin,env:{...baseEnv,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:path.join(home,'config'),DSH_HOME:home,DSH_SKIP_UPDATE:'1',DSH_SKIP_HOST_PREREQUISITES:'1',DSH_BIN:undefined,DSH_LOCAL_MANIFEST:path.join(root,'absent-overlay'),npm_config_userconfig:path.join(root,'empty-npmrc')},read:relative=>readFile(path.join(root,relative),'utf8')}
}

export function runProcess(command,args,options={}) {
  return new Promise(resolve=>{
    const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']})
    let stdout='',stderr=''
    child.stdout.on('data',chunk=>stdout+=chunk)
    child.stderr.on('data',chunk=>stderr+=chunk)
    const timer=setTimeout(()=>child.kill('SIGKILL'),20000)
    child.once('error',error=>{clearTimeout(timer);resolve({status:null,stdout,stderr,error})})
    child.once('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr})})
  })
}

// pty.fork gives the shell a new session and a real controlling slave tty.
// Closing the last master is the terminal-close event; no parent tree is killed.
export async function closeWindowsTerminal(fixture) {
  const consoleScript=path.join(fixture.root,'console.ps1')
  const returned=path.join(fixture.root,'console-returned')
  const handle=path.join(fixture.root,'console-handle')
  const event=path.join(fixture.root,'console-event')
  await writeFile(consoleScript, WINDOWS_CONSOLE)
  const env={...fixture.env,FIXTURE_NODE:process.execPath,FIXTURE_ENTRY:path.join(fixture.root,'bin/dsh.mjs'),FIXTURE_PORT:String(fixture.port),FIXTURE_HANDLE:handle,FIXTURE_RETURNED:returned,FIXTURE_EVENT:event}
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',consoleScript],{cwd:fixture.root,env,windowsHide:false,stdio:['ignore','pipe','pipe']})
  let stdout='',stderr=''
  child.stdout.on('data',chunk=>stdout+=chunk)
  child.stderr.on('data',chunk=>stderr+=chunk)
  const closed=new Promise(resolve=>child.once('close',(status,signal)=>resolve({status,signal})))
  try{
    const deadline=Date.now()+18000
    while(Date.now()<deadline){
      if(child.exitCode!==null)throw new Error('New console shell exited: '+stderr)
      try{if((await readFile(returned,'utf8')).trim()==='0')break}catch{}
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    if((await readFile(returned,'utf8')).trim()!=='0')throw new Error('Launcher did not return before console close')
    const before=await probePort(fixture.port)
    if(before.state!=='owned')throw new Error('Host not owned before console close')
    const hwnd=(await readFile(handle,'utf8')).trim()
    if(!/^[1-9][0-9]*$/.test(hwnd))throw new Error('No independent visible console HWND was proved')
    const script=`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class CloseOwnedConsole{[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}';$h=[IntPtr]::new([long]${hwnd});if(-not [CloseOwnedConsole]::IsWindowVisible($h)){throw 'Console is not visible; cannot prove real close'};if(-not [CloseOwnedConsole]::PostMessage($h,0x10,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'PostMessage console close failed'}`
    const sent=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env})
    if(sent.status!==0)throw new Error(sent.stderr)
    const exited=await Promise.race([closed,new Promise((_,reject)=>setTimeout(async()=>{
      const observedEvent=await readFile(event,'utf8').catch(()=>'<absent>')
      reject(new Error(`Console shell did not close: exitCode=${child.exitCode}; signal=${child.signalCode}; event=${observedEvent.trim()}; stderr=${stderr.slice(-1200)}`))
    },8000))])
    const code=(await readFile(event,'utf8')).trim()
    if(code!=='2')throw new Error('Console handler did not observe CTRL_CLOSE_EVENT: '+code)
    return {stdout,stderr,...exited,before,consoleEvent:code}
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill()
  }
}

const WINDOWS_CONSOLE=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class FixtureConsole {
  public delegate bool Handler(uint kind);
  static Handler handler;
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern bool AllocConsole();
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(Handler handler,bool add);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int size);
  public static int Launch() {
    var start=new ProcessStartInfo(Environment.GetEnvironmentVariable("FIXTURE_NODE"));
    start.UseShellExecute=false;
    start.Arguments="\""+Environment.GetEnvironmentVariable("FIXTURE_ENTRY")+"\" --port "+Environment.GetEnvironmentVariable("FIXTURE_PORT")+" --no-open";
    using(var child=Process.Start(start)){child.WaitForExit();return child.ExitCode;}
  }
  public static void Open() {
    FreeConsole();
    if(!AllocConsole())throw new Exception("Cannot allocate independent console");
    var h=GetConsoleWindow();
    var windowClass=new StringBuilder(256);
    GetClassName(h,windowClass,windowClass.Capacity);
    if(h==IntPtr.Zero||!IsWindowVisible(h)||windowClass.ToString()!="ConsoleWindowClass")throw new Exception("No classic owned console; window class="+windowClass+" (Windows Terminal proxy unsupported)");
    File.WriteAllText(Environment.GetEnvironmentVariable("FIXTURE_HANDLE"),h.ToInt64().ToString());
    handler=delegate(uint kind){File.WriteAllText(Environment.GetEnvironmentVariable("FIXTURE_EVENT"),kind.ToString());return false;};
    if(!SetConsoleCtrlHandler(handler,true))throw new Exception("Console event registration failed");
  }
}
'@
[FixtureConsole]::Open()
$status=[FixtureConsole]::Launch()
[IO.File]::WriteAllText($env:FIXTURE_RETURNED,[string]$status)
while($true){Start-Sleep -Milliseconds 100}
`

export const CLOSE_POSIX_TERMINAL = String.raw`
import os, pty, select, signal, sys, time
root, node, port = sys.argv[1:]
marker = b'FIXTURE_LAUNCHER_RETURNED'
shell = '''trap 'printf hup > "$FIXTURE_HUP_FILE"; exit 0' HUP
"$FIXTURE_NODE" "$FIXTURE_ENTRY" --port "$FIXTURE_PORT" --no-open
status=$?
printf 'FIXTURE_LAUNCHER_RETURNED:%s\\n' "$status"
while :; do read -r ignored; done
'''
os.environ.update(FIXTURE_NODE=node, FIXTURE_ENTRY=os.path.join(root,'bin','dsh.mjs'), FIXTURE_PORT=port, FIXTURE_HUP_FILE=os.path.join(root,'shell-hup'))
pid, master = pty.fork()
if pid == 0:
    os.chdir(root)
    os.execv('/bin/bash', ['bash','--noprofile','--norc','-c',shell])
output = b''
deadline = time.monotonic() + 15
try:
    while marker not in output and time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try: chunk = os.read(master, 65536)
            except OSError: break
            if not chunk: break
            output += chunk
    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()
    if marker+b':0' not in output:
        raise RuntimeError('launcher did not return successfully before terminal close: '+output.decode('utf-8', errors='replace')[-5000:])
finally:
    os.close(master)
deadline = time.monotonic() + 5
while time.monotonic() < deadline:
    finished, status = os.waitpid(pid, os.WNOHANG)
    if finished:
        print('PTY_CLOSED_AND_SHELL_EXITED')
        sys.exit(0)
    time.sleep(0.02)
raise RuntimeError('shell survived terminal close')
`

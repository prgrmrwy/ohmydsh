// Inert macOS ownership diagnostic; no real DSH Host, desktop or existing port touched.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
const repo = '/private/tmp/ohmydsh-macos-acceptance-sDkoXh8y/repo'
const { probePort, runPlatformCommand } = await import(pathToFileURL(path.join(repo, 'scripts/launcher/process.mjs')))
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-owner 中文 '))
const pkg = path.join(root, 'node_modules/@deepseek-ai/dsh'), bin = process.argv.includes('--foreign') ? path.join(root, 'foreign.mjs') : path.join(pkg, 'lib/bin.js')
await fs.mkdir(path.join(pkg, 'lib'), { recursive: true })
await fs.writeFile(path.join(pkg, 'package.json'), '{"name":"@deepseek-ai/dsh","type":"module"}')
await fs.writeFile(bin, `import net from 'node:net';net.createServer(s=>s.end()).listen(Number(process.argv.at(-1)),'127.0.0.1',()=>console.log('READY'))`)
const reservation = net.createServer().listen(0, '127.0.0.1');await once(reservation, 'listening');const port = reservation.address().port;await new Promise(r=>reservation.close(r))
const child = spawn(process.execPath, [bin, 'web', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
try {
 await once(child.stdout, 'data')
 const run = async (command, args, options) => { if(process.argv.includes('--utf8') && command==='ps') options={...options,env:{...options.env,LC_ALL:'en_US.UTF-8',LANG:'en_US.UTF-8'}}; const r = await runPlatformCommand(command, args, options);console.log(JSON.stringify({ command, args, status: r.status, stdout: r.stdout, stderr: r.stderr }));return r }
 console.log(JSON.stringify(await probePort(port, { run })))
} finally {
 if(child.exitCode===null){const done=once(child,'close');child.kill();await done}
 await fs.rm(root,{recursive:true,force:true})
}

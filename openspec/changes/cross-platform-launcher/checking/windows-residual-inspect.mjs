// Read-only recovery evidence; no install, import of native code, or filesystem mutation.
import fs from 'node:fs'
import path from 'node:path'
if (process.platform !== 'win32') throw Error('Native Windows required')
const root = 'D:\\opensource\\ohmydsh\\packages\\dsh-pet\\compat\\subagent'
const link = path.join(root, '.launcher.next-7372-4f705365-7416-4d03-8afc-a4103b072274')
const stat = fs.lstatSync(link)
if (!stat.isSymbolicLink()) throw Error('Unexpected residual entity')
const target = fs.realpathSync(link)
console.log(JSON.stringify({ link, target, active: fs.realpathSync(path.join(root, '.launcher')), fingerprint: fs.readFileSync(path.join(target, '.fingerprint'), 'utf8').trim(), bin: fs.existsSync(path.join(target, 'node_modules/@deepseek-ai/dsh/lib/bin.js')), identity: { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs, ctimeMs: stat.ctimeMs } }))

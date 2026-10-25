// One-shot human-approved recovery: only the exact prior failed attempt's next symlink.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
if (process.platform !== 'win32') throw Error('Native Windows required')
const repo = 'D:\\opensource\\ohmydsh'
const root = path.join(repo, 'packages/dsh-pet/compat/subagent')
const link = path.join(root, '.launcher.next-7372-4f705365-7416-4d03-8afc-a4103b072274')
const target = path.join(root, '.launcher-builds/56ad6e1789b583155943f3b47ff76afdd45454a8b8deed3d61ddf0912d56095d-cffc9646-96ff-42e1-92b9-bde01176823b')
const active = path.join(root, '.launcher-builds/5f5bc79718e5fab4eb902d9677de6db4c5054be376a841500919398a605fd404-ffa4f3be-9c22-4ac9-8f6d-2e6974dc1758')
const require = createRequire(import.meta.url)
const lock = require(path.join(root, 'compat-build-lock.cjs')).acquireCompatBuildLock({ allowInherited: false, waitMs: 5000 })
try {
  const stat = fs.lstatSync(link)
  if (!stat.isSymbolicLink() || stat.dev !== 3221248581 || stat.ino !== 281474980155016 || stat.birthtimeMs !== 1792867812744.6978 || stat.ctimeMs !== 1792867812744.6978) throw Error('Residual identity changed')
  if (fs.realpathSync(link) !== target || fs.realpathSync(path.join(root, '.launcher')) !== active) throw Error('Pointer target changed')
  const before = fs.readFileSync(path.join(target, '.fingerprint'), 'utf8')
  fs.unlinkSync(link)
  if (fs.existsSync(link) || fs.realpathSync(path.join(root, '.launcher')) !== active || fs.readFileSync(path.join(target, '.fingerprint'), 'utf8') !== before) throw Error('Recovery postcondition failed')
  require(path.join(root, 'compat-publish.cjs')).assertPublicationState(path.join(root, '.launcher'))
  const policyFile = path.join(root, 'install-script-policy.json')
  const oldHash = createHash('sha256').update(fs.readFileSync(policyFile)).digest('hex')
  if (oldHash !== '91019685f79d6ecff18fd3981d3f2ac031c3a3bd46da0123e054f48162542671') throw Error('Native policy changed')
  const source = path.resolve(import.meta.dirname, '../../../..', 'packages/dsh-pet/compat/subagent/install-script-policy.json')
  const policy = JSON.parse(fs.readFileSync(source, 'utf8'))
  const expected = { '@google/genai@1.52.0': false, '@google/genai@2.21.0': false, 'protobufjs@7.6.6': false, '@deepseek-ai/dsh-subprocess-local@0.2.0-rc.2': true, 'koffi@3.1.1': true, 'node-pty@1.2.0-beta.15': true }
  if (JSON.stringify(policy) !== JSON.stringify(expected)) throw Error('Source policy differs from approved rules')
  fs.copyFileSync(source, policyFile)
  console.log(JSON.stringify({ recovery: 'exact-next-link-unlinked', activePreserved: true, targetPreserved: true, policy: expected }))
} finally { lock.release() }

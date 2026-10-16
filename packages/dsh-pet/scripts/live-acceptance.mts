/**
 * Live acceptance harness for pet-locus-doc-comments (tasks 10.5).
 *
 * Runs Pet's REAL transport and doc-comment modules against a disposable
 * Feishu app:
 *   ChannelSubscription (connection gate + one `+subscribe`)
 *   → createDocCommentIntake → queryDocComment → admitDocCommentEvent
 *   → a stub controller that replies immediately through the real egress
 *     (sendDocBusinessReply / reactOnDocTrigger).
 *
 * The Host, Agent and durable locus tree are NOT booted here. Those are
 * covered by the unit and integration suites.
 *
 * Usage (DSH stopped, or another app):
 *   node --experimental-strip-types scripts/live-acceptance.mts <profile> <allowOpenId> [seconds]
 *
 * Prints one line per observation, never a credential. The stderr of
 * `+subscribe` is matched only, never printed.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ChannelSubscription } from '../src/host/channel/subscription.js'
import { runConnectionGate } from '../src/host/channel/connection-gate.js'
import { createLarkCliClient, type LarkCliRunner } from '../src/host/channel/lark.js'
import { createDocCommentIntake } from '../src/host/channel/doc-comment-intake.js'
import { reactOnDocTrigger, sendDocBusinessReply } from '../src/host/channel/doc-comment-egress.js'

const [profile, allow, secondsRaw] = process.argv.slice(2)
if (profile === undefined || allow === undefined) {
  console.error('usage: live-acceptance.mts <profile> <allowOpenId> [seconds]')
  process.exit(2)
}
const seconds = Number(secondsRaw ?? '600')
const exec = promisify(execFile)

// The only change from production: swap Pet's fixed profile for the test app.
const runner: LarkCliRunner = (binary, args, options) => {
  const swapped = [...args]
  const at = swapped.indexOf('--profile')
  if (at !== -1) swapped[at + 1] = profile
  return exec(binary, swapped, options) as never
}
const client = createLarkCliClient('lark-cli', runner, message => console.log(`[client] ${message}`))

const bot = await exec('lark-cli', ['--profile', profile, 'api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot'])
const botOpenId = (JSON.parse(bot.stdout) as { data: { bot?: { open_id?: string }; open_id?: string } }).data
const botId = botOpenId.bot?.open_id ?? botOpenId.open_id
console.log(`[setup] bot=${botId === undefined ? 'unknown' : 'resolved'} allow=1 window=${seconds}s`)

const stop = new AbortController()
const seen = new Set<string>()
const entries = new Set<string>()

const intake = createDocCommentIntake({
  client,
  admissionContext: () => ({
    ...(botId === undefined ? {} : { botOpenId: botId }),
    allowOpenIds: [allow],
    watermark: startedAt,
    isDuplicate: id => seen.has(id),
    // Not a durable tree: the first allowlisted @ initialises the entry, then it is authorized.
    authorization: endpoint => (entries.has(`${endpoint.chatId}|${endpoint.threadId ?? ''}`) ? 'authorized' : 'uninitialized'),
  }),
  handleAdmission: async admission => {
    if (admission.kind !== 'accepted') {
      console.log(`[admission] rejected reason=${admission.reason}`)
      return { kind: 'refused', reason: admission.reason } as never
    }
    const message = admission.message
    seen.add(message.messageId)
    entries.add(`${message.endpoint.chatId}|${message.endpoint.threadId ?? ''}`)
    const level = message.endpoint.threadId === undefined ? 'doc-level(group)' : 'comment-level(topic)'
    const quote = 'docComment' in message && message.docComment !== undefined ? ` quote=${JSON.stringify(message.docComment.quote.slice(0, 40))}` : ''
    console.log(`[admission] accepted ${level} control=${admission.kind === 'accepted' && 'command' in admission ? 'yes' : 'no'}${quote}`)
    await reactOnDocTrigger(client, message.messageId, 'accepted').then(
      () => console.log('[react] Typing added'),
      error => console.log(`[react] failed (fail-soft): ${String(error).slice(0, 80)}`),
    )
    const reply = await sendDocBusinessReply(client, {
      chatId: message.endpoint.chatId,
      ...(message.endpoint.threadId === undefined ? {} : { threadId: message.endpoint.threadId }),
      messageId: message.messageId,
    }, `[pet live acceptance] 已收到（${level}）：${message.text.slice(0, 60)}`)
    console.log(`[reply] ${reply.kind}${reply.kind === 'refused' ? ` ${reply.reason}` : ''}`)
    await reactOnDocTrigger(client, message.messageId, reply.kind === 'sent' ? 'settled' : 'failed').then(
      () => console.log(`[react] Typing removed, ${reply.kind === 'sent' ? 'DONE' : 'CRY'} added`),
      error => console.log(`[react] failed (fail-soft): ${String(error).slice(0, 80)}`),
    )
    return { kind: 'accepted' } as never
  },
  active: () => !stop.signal.aborted,
  signal: () => stop.signal,
  onOutcome: outcome => {
    if (outcome.kind === 'ignored') console.log(`[intake] ignored reason=${outcome.reason}`)
    if (outcome.kind === 'cancelled') console.log('[intake] cancelled')
  },
})

const startedAt = Date.now()
const subscription = new ChannelSubscription({
  profile,
  onLine: line => {
    const type = /"type":"([^"]+)"/.exec(line)?.[1] ?? 'unknown'
    if (type === 'drive.notice.comment_add_v1') {
      console.log('[event] comment')
      void intake(line).catch(error => console.log(`[intake] error ${String(error).slice(0, 80)}`))
    } else {
      console.log(`[event] ${type}`)
    }
  },
  onStatus: status => console.log(`[status] ${status.phase}${'reason' in status && status.reason ? ` reason=${String(status.reason)}` : ''}${'diagnostic' in status && status.diagnostic ? ` diag=${String(status.diagnostic).slice(0, 120)}` : ''}`),
  gate: signal => runConnectionGate({
    cliVersion: async () => (await client.cliVersion?.())?.version,
    connectionCount: async () => (await client.eventConnectionCount?.()) ?? { kind: 'error', authFailure: false },
    sleep: (ms, s) => new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      s.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
    }),
  }, signal),
})

const shutdown = (why: string): void => {
  console.log(`[setup] stopping (${why})`)
  stop.abort()
  subscription.stop()
  setTimeout(() => process.exit(0), 3_000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
setTimeout(() => shutdown('window elapsed'), seconds * 1000).unref()

subscription.start()
setInterval(() => {}, 1 << 30)

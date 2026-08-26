// Hover probe: open the DSH GUI, find the worktree base-ref chooser button,
// inspect its title attribute and native tooltip behaviour.
import { createRequire } from 'node:module'
const require = createRequire('/Users/bytedance/.nvm/versions/node/v24.12.0/lib/node_modules/@playwright/cli/node_modules/')
const { chromium } = require('playwright')

const CHROME = '/Users/bytedance/.agent-browser/browsers/chrome-150.0.7871.46/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

// Create a fresh blank session on the current workspace (ohmydsh).
const newSession = page.locator('button', { hasText: '新会话' }).first()
if (await newSession.count()) {
  await newSession.click().catch(() => {})
  await page.waitForTimeout(3000)
}
console.log('url after new session:', page.url())

// The chooser button lives in the input-area left slot: style contains
// text-overflow:ellipsis and text starts with the glyph.
const candidates = await page.locator('button').evaluateAll((buttons) => buttons.map((b) => ({
  text: b.textContent?.slice(0, 40),
  title: b.getAttribute('title'),
  aria: b.getAttribute('aria-label'),
  style: b.getAttribute('style')?.slice(0, 160) ?? '',
  visible: !!(b.offsetParent),
  rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
}))).catch((e) => { console.error('evaluateAll failed', e); return [] })

const choosers = candidates.filter((c) => (c.text ?? '').includes('⑂') || (c.style ?? '').includes('ellipsis'))
console.log('buttons with ⑂/ellipsis:', JSON.stringify(choosers, null, 1))

const chooser = choosers.find((c) => (c.text ?? '').includes('⑂'))
if (!chooser) {
  console.log('NO CHOOSER BUTTON FOUND — page state?', candidates.slice(0, 12).map(c => `${c.text} | title=${c.title} | vis=${c.visible}`))
  await page.screenshot({ path: 'checking/hover-probe-1.png' })
  await browser.close()
  process.exit(0)
}

// hover it and wait for the native tooltip
const button = page.locator('button', { hasText: '⑂' }).first()
await button.hover()
await page.waitForTimeout(2500) // native title delay ~1s
const after = await button.evaluate((el) => ({ aria: el.getAttribute('aria-label'), hovered: el.matches(':hover'), rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })() }))
const labelCount = await page.locator('[data-testid="worktree-session-ref-hover"]').count()
const labelText = labelCount > 0 ? await page.locator('[data-testid="worktree-session-ref-hover"]').first().textContent() : null
console.log('hover label present:', labelCount, '| text:', labelText)
console.log('after hover:', JSON.stringify(after))
await page.screenshot({ path: 'checking/hover-probe-2.png' })

// Also check what element is actually at the button's center point (hit-testing)
const hit = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('⑂'))
  const r = b?.getBoundingClientRect()
  if (!r) return null
  const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return { tag: el?.tagName, cls: el?.className?.toString().slice(0, 80), title: el?.getAttribute?.('title') }
})
console.log('hit test at center:', JSON.stringify(hit))
await browser.close()

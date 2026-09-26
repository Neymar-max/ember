// UI check for the model/effort picker and the context/plan-usage ring (REAL CLI, sonnet, one tiny turn).
// Usage: npx electron-vite build && node scripts/e2e-usage.mjs [shotDir]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = process.argv[2] || join(process.cwd(), 'e2e-shots-usage')
mkdirSync(SHOTS, { recursive: true })
const proj = mkdtempSync(join(tmpdir(), 'ember-usage-'))
const app = await electron.launch({ args: ['.'], env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1280, height: 840 })
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let n = 0
const shot = async (name) => { const f = join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`); await win.screenshot({ path: f }); console.log('shot', f) }
const chat = () => win.evaluate(() => { const s = window.__emberStores.useChats.getState(); const c = s.chats[s.activeChatId]; return c && { status: c.status, effort: c.effort, model: c.model, ctx: c.contextTokens, max: c.contextMax, sid: c.sessionId, last: !!c.lastResult } })

try {
  await win.waitForSelector('.em-shell-newchat', { timeout: 60000 })
  await win.click('.em-shell-newchat')
  await win.evaluate((dir) => { const s = window.__emberStores.useChats.getState(); s.setCwd(s.activeChatId, dir) }, proj)
  await win.waitForTimeout(2500) // let the startup plan-usage fetch land
  await shot('composer-default')

  await win.click('.em-composer__pill--model')
  await win.waitForTimeout(300)
  await shot('model-picker')
  await win.keyboard.press('Escape')
  await win.click('.em-effort-chip')
  await win.waitForTimeout(300)
  await win.locator('.em-effort__range').fill('5')
  await win.waitForTimeout(250)
  await shot('effort-ultracode')
  await win.locator('.em-effort__range').fill('2')
  console.log('after slider 高:', JSON.stringify(await chat()))
  // keyboard on the slider: one step left
  await win.locator('.em-effort__range').focus()
  await win.keyboard.press('ArrowLeft')
  console.log('after ArrowLeft:', JSON.stringify(await chat()))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)

  await win.hover('.em-usage-ring')
  await win.waitForTimeout(900)
  await shot('usage-card-before-send')
  await win.mouse.move(640, 300)
  await win.waitForTimeout(400)

  await win.evaluate(() => { const s = window.__emberStores.useChats.getState(); return s.setModel(s.activeChatId, 'sonnet') })
  const ta = win.locator('.em-composer__textarea'); await ta.click(); await ta.fill('Reply with exactly: PONG'); await win.keyboard.press('Enter')
  for (let i = 0; i < 120; i++) { await win.waitForTimeout(500); const c = await chat(); if (c?.last && c.status === 'idle') break }
  await win.waitForTimeout(2500)
  console.log('after turn:', JSON.stringify(await chat()))
  // change effort while the session is live (applyFlagSettings path)
  await win.click('.em-effort-chip'); await win.waitForTimeout(250)
  await win.locator('.em-effort__range').fill('0')
  await win.keyboard.press('Escape')
  console.log('live effort change:', JSON.stringify(await chat()))
  await win.mouse.move(640, 300)
  await win.waitForTimeout(300)
  await win.hover('.em-usage-ring')
  await win.waitForTimeout(1500)
  await shot('usage-card-after-turn')
  const card = await win.locator('.em-usage').innerText({ timeout: 5000 })
  console.log('card text:\n' + card)
  await win.evaluate(() => window.__emberStores.useApp.getState().updateSettings({ theme: 'dark' }))
  await win.waitForTimeout(400)
  await shot('usage-card-dark')
  await win.evaluate(() => window.__emberStores.useApp.getState().updateSettings({ theme: 'light' }))
} finally {
  const sid = (await chat().catch(() => null))?.sid
  if (sid) await win.evaluate((id) => window.ember.history.delete(id), sid).catch(() => {})
  console.log('deleted', sid, '| renderer errors:', errors.length ? errors : 'none')
  await app.close()
}

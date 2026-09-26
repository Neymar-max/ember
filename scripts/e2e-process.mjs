// Live run (REAL CLI, sonnet): thinking shows as one line while streaming, the working steps
// fold into one grey summary line between prose, and can be opened.
// Usage: npx electron-vite build && node scripts/e2e-process.mjs [shotDir] [userDataDir]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = process.argv[2] || join(process.cwd(), 'e2e-shots-process')
mkdirSync(SHOTS, { recursive: true })
const proj = mkdtempSync(join(tmpdir(), 'ember-proc-'))
writeFileSync(join(proj, 'a.txt'), 'alpha 3\nbeta 5\ngamma 9\n')
const args = ['.', ...(process.argv[3] ? [`--user-data-dir=${process.argv[3]}`] : [])]
const app = await electron.launch({ args, cwd: process.cwd(), env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1180, height: 860 })
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let n = 0
const shot = async (name) => { const f = join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`); await win.screenshot({ path: f }); console.log('shot', f) }
const state = () => win.evaluate(() => {
  const s = window.__emberStores.useChats.getState(); const c = s.chats[s.activeChatId]
  return c && { status: c.status, sid: c.sessionId, groups: document.querySelectorAll('.em-chat-steps').length, labels: [...document.querySelectorAll('.em-chat-steps__head')].map((e) => e.textContent), thinking: document.querySelectorAll('.em-chat-thinking').length, users: [...document.querySelectorAll('.em-chat-user')].map((e) => e.textContent) }
})
try {
  await win.waitForSelector('.em-shell-newchat', { timeout: 60000 })
  await win.click('.em-shell-newchat')
  await win.evaluate((dir) => { const s = window.__emberStores.useChats.getState(); s.setCwd(s.activeChatId, dir); return s.setModel(s.activeChatId, 'sonnet') }, proj)
  await win.evaluate(() => { const s = window.__emberStores.useChats.getState(); s.setPermissionMode(s.activeChatId, 'acceptEdits'); return s.setEffort(s.activeChatId, 'high') })
  const ta = win.locator('.em-composer__textarea')
  await ta.click()
  await ta.fill('先读 a.txt 并说一句你看到了什么；然后用 ls 看目录；再新建 sum.txt 写入三个数字之和；最后一句话告诉我结果。')
  await win.keyboard.press('Enter')
  let sawOpen = false, sawThinking = false
  const t0 = Date.now()
  while (Date.now() - t0 < 180000) {
    await win.waitForTimeout(500)
    const s = await state()
    if (s.groups) { if (!sawOpen) await shot('working'); sawOpen = true }
    if (s.thinking) sawThinking = true
    if (s.status === 'idle' && s.sid) break
  }
  await win.waitForTimeout(1200)
  const done = await state()
  await shot('done-folded')
  const fold = await win.locator('.em-chat-fold').textContent().catch(() => null)
  console.log('fold', fold)
  await win.click('.em-chat-fold')
  await win.waitForTimeout(300)
  await win.click('.em-chat-steps__head')
  await win.waitForTimeout(300)
  await shot('reopened')
  const th = win.locator('.em-chat-thinking__row:not([disabled])').first()
  if (await th.count()) { await th.click(); await win.waitForTimeout(300); await shot('thinking-expanded') }
  console.log(JSON.stringify({ sawOpen, sawThinking, done, errors }))
} finally {
  await app.close()
}

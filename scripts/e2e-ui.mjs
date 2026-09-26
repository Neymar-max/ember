// End-to-end UI run against the REAL Claude Code CLI (model: haiku), driving the UI like a user.
// Usage: npx electron-vite build && node scripts/e2e-ui.mjs [shotDir]
// Produces screenshots + prints renderer console errors. Deletes the sessions it created.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = process.argv[2] || join(process.cwd(), 'e2e-shots')
mkdirSync(SHOTS, { recursive: true })
const proj = mkdtempSync(join(tmpdir(), 'ember-e2e-'))
mkdirSync(join(proj, 'src'))
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'demo-app', version: '0.1.0', scripts: { start: 'node src/app.js' } }, null, 2))
writeFileSync(join(proj, 'src/app.js'), "function greet(name) {\n  return 'Hi ' + name\n}\nconsole.log(greet('world'))\n")

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' },
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1280, height: 840 })
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

let n = 0
const shot = async (name) => {
  const f = join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`)
  await win.screenshot({ path: f })
  console.log('shot', f)
}
const store = (fn, arg) => win.evaluate(fn, arg)
const activeChat = () =>
  store(() => {
    const s = window.__emberStores.useChats.getState()
    const c = s.chats[s.activeChatId]
    return c && { status: c.status, sessionId: c.sessionId, pending: c.pendingPermissions.length, items: c.items.length, todos: c.todos.length, error: c.error, last: c.lastResult }
  })

async function runTurn(label, text, { maxMs = 240000, answer = true } = {}) {
  const ta = win.locator('.em-composer__textarea')
  await ta.click()
  await ta.fill(text)
  await win.keyboard.press('Enter')
  const t0 = Date.now()
  let shotRunning = false
  let permShots = 0
  let lastResult = null
  // wait until the turn started, then until it is idle again with a result
  while (Date.now() - t0 < maxMs) {
    await win.waitForTimeout(700)
    const c = await activeChat()
    if (!c) continue
    if (!shotRunning && c.status === 'running' && Date.now() - t0 > 2500) { await shot(`${label}-running`); shotRunning = true }
    const card = win.locator('.em-ix-card')
    if (await card.count()) {
      if (permShots < 2) { await shot(`${label}-permission-${++permShots}`) }
      if (answer) {
        const q = win.locator('.em-ix-card button.em-ui-btn--primary').first()
        await q.click().catch(() => {})
        await win.waitForTimeout(300)
      }
      continue
    }
    if (c.status === 'idle' && c.last && JSON.stringify(c.last) !== JSON.stringify(lastResult) && Date.now() - t0 > 3000) {
      lastResult = c.last
      break
    }
    if (c.status === 'error') { console.log('chat error', c.error); break }
  }
  await win.waitForTimeout(800)
  console.log(label, 'done in', Date.now() - t0, 'ms', JSON.stringify(await activeChat()))
}

try {
  await win.waitForSelector('.em-shell-newchat', { timeout: 60000 })
  await win.waitForTimeout(800)
  await shot('home')

  await win.click('.em-shell-newchat')
  await win.waitForTimeout(400)
  await store((dir) => {
    const s = window.__emberStores.useChats.getState()
    s.setCwd(s.activeChatId, dir)
    return s.setModel(s.activeChatId, 'haiku')
  }, proj)
  await win.waitForTimeout(300)
  await shot('new-chat')

  await runTurn(
    'turn1',
    '请依次：1) 读取 package.json；2) 用 Bash 运行 `ls -la src`；3) 修改 src/app.js，把问候语改成 "Hello, " 并加一行注释；4) 新建 README.md 写两行项目说明。最后用中文给一个简短总结。',
  )
  await shot('turn1-done')
  // expand every collapsed tool row once for a detail shot
  const rows = win.locator('button.em-tool-row:not(.is-expanded)')
  const count = Math.min(await rows.count(), 6)
  for (let i = 0; i < count; i++) await rows.nth(i).click().catch(() => {})
  await win.waitForTimeout(500)
  await shot('turn1-expanded')

  await runTurn(
    'turn2',
    '用你的任务列表工具（TaskCreate/TaskUpdate）建 3 个小任务：检查代码风格、补充注释、写一个测试想法；逐个标记完成。最后用 Markdown 回复：一个 3 行的表格（文件名/行数/用途）、一段 js 代码块、一个引用块、一个任务清单。',
  )
  await shot('turn2-done')
  await win.evaluate(() => {
    const el = document.querySelector('.em-chat-view__scroller')
    if (el) el.scrollTop = el.scrollHeight
  })
  await shot('turn2-bottom')

  // dark theme
  await store(() => window.__emberStores.useApp.getState().updateSettings({ theme: 'dark' }))
  await win.waitForTimeout(600)
  await shot('dark')
  await store(() => window.__emberStores.useApp.getState().updateSettings({ theme: 'light' }))

  // settings dialog
  await store(() => window.__emberStores.useApp.getState().setSettingsOpen(true))
  await win.waitForTimeout(500)
  await shot('settings')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  // open a history session created by the CLI fixtures (if present)
  const opened = await store(async () => {
    const a = window.__emberStores.useApp.getState()
    await a.refreshSessions()
    const s = window.__emberStores.useApp.getState().sessions.find((x) => (x.cwd || '').includes('ember-fx') && /package|Package/.test(x.title))
    if (!s) return null
    await window.__emberStores.useChats.getState().openHistory(s)
    return s.title
  })
  if (opened) {
    await win.waitForTimeout(1200)
    await shot('history')
  }
} finally {
  // clean up the session(s) we created in the temp project
  const ids = await store((dir) => Object.values(window.__emberStores.useChats.getState().chats).filter((c) => c.sessionId && (c.cwd === dir || c.cwd === '/private' + dir)).map((c) => c.sessionId), proj).catch(() => [])
  for (const id of ids) await store((sid) => window.ember.history.delete(sid), id).catch(() => {})
  console.log('deleted test sessions', ids)
  console.log('renderer errors:', errors.length ? errors : 'none')
  console.log('project files:', ['src/app.js', 'README.md'].map((f) => `${f}=${existsSync(join(proj, f)) ? readFileSync(join(proj, f), 'utf8').slice(0, 80).replace(/\n/g, '⏎') : 'MISSING'}`).join(' | '))
  await app.close()
}

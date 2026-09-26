// Live run (REAL CLI, haiku): side panel (subagent status, changed files, preview), a message
// sent mid-turn shows "queued" then "read" once the CLI picks it up.
// Usage: npx electron-vite build && node scripts/e2e-panel.mjs [shotDir] [userDataDir]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = process.argv[2] || join(process.cwd(), 'e2e-shots-panel')
mkdirSync(SHOTS, { recursive: true })
const proj = mkdtempSync(join(tmpdir(), 'ember-panel-'))
writeFileSync(join(proj, 'a.txt'), 'alpha 3\nbeta 5\ngamma 9\n')
const args = ['.', ...(process.argv[3] ? [`--user-data-dir=${process.argv[3]}`] : [])]
const app = await electron.launch({ args, cwd: process.cwd(), env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8' } })
const win = await app.firstWindow()
await win.setViewportSize({ width: 1400, height: 880 })
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
let n = 0
const shot = async (name) => { const f = join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`); await win.screenshot({ path: f }); console.log('shot', f) }
const st = () => win.evaluate(() => {
  const s = window.__emberStores.useChats.getState(); const c = s.chats[s.activeChatId]
  return c && { status: c.status, queued: (c.queued ?? []).length, delivery: c.items.filter((i) => i.kind === 'user').map((i) => i.delivery ?? '-'), tasks: document.querySelectorAll('.em-panel-task').length, runningTasks: document.querySelectorAll('.em-panel-task.is-running').length }
})
const send = async (text) => { const ta = win.locator('.em-composer__textarea'); await ta.click(); await ta.fill(text); await win.keyboard.press('Enter') }
const log = []
try {
  await win.waitForSelector('.em-shell-newchat', { timeout: 60000 })
  await win.click('.em-shell-newchat')
  await win.evaluate((dir) => { const s = window.__emberStores.useChats.getState(); s.setCwd(s.activeChatId, dir); s.setPermissionMode(s.activeChatId, 'bypassPermissions'); return s.setModel(s.activeChatId, 'haiku') }, proj)
  await send('按顺序做：1) 用 Agent 工具派一个 general-purpose 子 agent，让它读 a.txt 并用一句话总结（不要后台运行）；2) 你自己用 Bash 运行 `sleep 10; echo done`；3) 新建 notes.md，写一个标题和一行总结；4) 回复一句话，并用 markdown 链接 [notes.md](notes.md) 指向它。')
  await win.waitForTimeout(2500)
  await win.evaluate(() => window.__emberStores.usePanel?.getState().setOpen(true))
  if (!(await win.locator('.em-panel').count())) await win.click('.em-shell-header__panel')
  let sentMid = false, sawQueued = false, sawRead = false, sawRunningTask = false
  const t0 = Date.now()
  while (Date.now() - t0 < 240000) {
    await win.waitForTimeout(700)
    const s = await st()
    log.push(JSON.stringify(s))
    if (s.runningTasks && !sawRunningTask) { sawRunningTask = true; await shot('task-running') }
    if (!sentMid && (s.runningTasks || Date.now() - t0 > 12000)) { await send('另外，最后一句话结尾加上 BANANA。'); sentMid = true; await win.waitForTimeout(400); await shot('queued'); }
    if (s.queued) sawQueued = true
    if (s.delivery.includes('read')) { if (!sawRead) await shot('read'); sawRead = true }
    if (sentMid && s.status === 'idle' && !s.queued) break
  }
  await win.waitForTimeout(1500)
  await shot('done-tasks')
  await win.locator('.em-panel__tab').nth(1).click()
  await win.waitForTimeout(1500)
  await shot('files')
  const link = win.locator('.em-chat-assistant a', { hasText: 'notes.md' }).last()
  if (await link.count()) { await link.click(); await win.waitForTimeout(800); await shot('preview-from-link') }
  const final = await st()
  console.log(JSON.stringify({ sawRunningTask, sawQueued, sawRead, final, preview: await win.locator('.em-panel-preview').count(), errors }))
} finally {
  await app.close()
}

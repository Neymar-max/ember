// Second end-to-end UI run (REAL CLI, haiku): plan-mode approval card, AskUserQuestion card,
// async subagent, auto-resume after the live process is closed, narrow window.
// Usage: npx electron-vite build && node scripts/e2e-ui2.mjs [shotDir]
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = process.argv[2] || join(process.cwd(), 'e2e-shots-2')
mkdirSync(SHOTS, { recursive: true })
const proj = mkdtempSync(join(tmpdir(), 'ember-e2e2-'))
writeFileSync(join(proj, 'notes.md'), '# Notes\n\nSome notes.\n')

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: 'zh_CN.UTF-8', ...(process.env.EMBER_RECORD ? { EMBER_RECORD: process.env.EMBER_RECORD } : {}) },
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
const chatState = () =>
  win.evaluate(() => {
    const s = window.__emberStores.useChats.getState()
    const c = s.chats[s.activeChatId]
    if (!c) return null
    return {
      chatId: c.chatId, status: c.status, sessionId: c.sessionId, mode: c.permissionMode, pending: c.pendingPermissions.map((p) => p.toolName),
      bg: c.backgroundTasks.map((b) => b.status), last: c.lastResult && c.lastResult.subtype, items: c.items.length,
      tools: Object.values(c.tools).map((t) => `${t.name}:${t.status}`),
    }
  })

async function send(text) {
  const ta = win.locator('.em-composer__textarea')
  await ta.click()
  await ta.fill(text)
  await win.keyboard.press('Enter')
}

/** Wait until the predicate over chat state is true (or card shows up when `card` given). */
async function waitFor(pred, { maxMs = 240000, label = '' } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await win.waitForTimeout(700)
    const c = await chatState()
    if (c && (await pred(c))) return c
  }
  console.log('TIMEOUT waiting for', label, JSON.stringify(await chatState()))
  return null
}
const turnDone = (startItems) => (c) => c.status === 'idle' && c.items > startItems && c.last && c.pending.length === 0

/** Send a prompt and drive every card that appears until the turn is idle again. */
async function driveTurn(label, text, { pick = 0, maxMs = 300000, waitBackground = false } = {}) {
  const before = (await chatState())?.items ?? 0
  await send(text)
  const t0 = Date.now()
  const seen = new Set()
  while (Date.now() - t0 < maxMs) {
    await win.waitForTimeout(700)
    const c = await chatState()
    if (!c) continue
    if (c.pending.length) {
      const kind = c.pending[0]
      const key = kind + ':' + c.pending.length + ':' + seen.size
      if (!seen.has(kind)) { await shot(`${label}-card-${kind}`); seen.add(kind) }
      if (kind === 'AskUserQuestion') {
        await win.locator('.em-ix-q-option').nth(pick).click().catch(() => {})
        await win.waitForTimeout(150)
        await win.locator('.em-ix-question .em-ix-actions button.em-ui-btn--primary').first().click().catch(() => {})
      } else if (kind === 'ExitPlanMode') {
        await win.locator('.em-ix-plan .em-ix-actions button').nth(1).click().catch(() => {})
      } else {
        await win.locator('.em-ix-card button.em-ui-btn--primary').first().click().catch(() => {})
      }
      await win.waitForTimeout(400)
      continue
    }
    const bgBusy = waitBackground && (c.bg.some((b) => b === 'running') || !c.tools.some((t) => /^(Agent|Task):(done|error)/.test(t)))
    if (c.status === 'idle' && c.items > before && c.last && !bgBusy) break
  }
  await win.waitForTimeout(1200)
  console.log(label, 'done in', Date.now() - t0, 'ms', JSON.stringify(await chatState()))
}

try {
  await win.waitForSelector('.em-shell-newchat', { timeout: 60000 })
  await win.click('.em-shell-newchat')
  await win.waitForTimeout(300)
  await win.evaluate(async (dir) => {
    const s = window.__emberStores.useChats.getState()
    s.setCwd(s.activeChatId, dir)
    await s.setModel(s.activeChatId, 'haiku')
    await s.setPermissionMode(s.activeChatId, 'plan')
  }, proj)
  await win.waitForTimeout(300)
  await shot('plan-mode-empty')

  await driveTurn('plan', '请为这个目录规划：新建 README.md，内容两行项目介绍（项目名就叫 Demo，不用问我）。计划只要 2 条要点，想好后调用 ExitPlanMode，获批后执行。')
  await shot('plan-done')
  console.log('README exists:', existsSync(join(proj, 'README.md')))

  await driveTurn('ask', '先用 AskUserQuestion 工具问我一个单选问题：hello world 用哪种语言（给 3 个选项）。拿到答案后只输出对应语言的代码块，不要建文件。', { pick: 1 })
  await shot('ask-done')

  await driveTurn('agent', '用 Agent 工具启动一个 general-purpose 子代理：让它用 Bash 运行 `echo hi-from-subagent && ls`，然后汇报结果。等子代理完成后用一句话总结。', { waitBackground: true })
  const agentRow = win.locator('button.em-tool-row').filter({ hasText: /子代理|Subagent|Agent/ }).first()
  if (await agentRow.count()) await agentRow.click()
  await win.waitForTimeout(500)
  await shot('agent-expanded')

  const { chatId, sessionId } = await chatState()
  await win.evaluate((id) => window.ember.session.close(id), chatId)
  await win.waitForTimeout(1500)
  await driveTurn('resume', '刚才子代理输出了什么？一句话回答。')
  const c = await chatState()
  console.log('resume kept session:', c && c.sessionId === sessionId)
  await shot('resumed')

  await win.setViewportSize({ width: 900, height: 620 })
  await win.waitForTimeout(500)
  await shot('narrow')
} finally {
  const ids = await win.evaluate((dir) => Object.values(window.__emberStores.useChats.getState().chats).filter((c) => c.sessionId && (c.cwd === dir || c.cwd === '/private' + dir)).map((c) => c.sessionId), proj).catch(() => [])
  for (const id of ids) await win.evaluate((sid) => window.ember.history.delete(sid), id).catch(() => {})
  console.log('deleted test sessions', ids)
  console.log('renderer errors:', errors.length ? errors : 'none')
  await app.close()
}

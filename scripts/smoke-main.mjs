#!/usr/bin/env node
/**
 * WP-A smoke test: launches the built app with a Finder-like minimal env
 * (HOME/USER/PATH=/usr/bin:/bin/LANG only) via playwright-core's `_electron`,
 * and exercises env probing, history, settings, files.suggest, a real
 * streaming session (PONG), and a permission round-trip.
 *
 * Requires `npx electron-vite build` to have produced out/main + out/preload
 * (out/renderer can be stale — the renderer isn't touched by this test).
 * Costs a few cents of real API usage (haiku). Cleans up the two temporary
 * SDK sessions it creates via history.delete() → deleteSession().
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`)
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`SMOKE FAIL: timed out waiting for ${label} after ${timeoutMs}ms`)
}

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: { HOME: process.env.HOME, USER: process.env.USER, PATH: '/usr/bin:/bin', LANG: process.env.LANG || 'en_US.UTF-8' },
})

const tmpDirs = []
const sessionIdsToDelete = []

try {
  const win = await app.firstWindow()
  win.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[renderer:error]', msg.text())
  })

  // 1. env.get() → ready, with account + models
  console.log('→ env.get()')
  const env = await win.evaluate(() => window.ember.env.get())
  console.log(`  state=${env.state} email=${env.account?.email} models=${env.models?.length} cli=${env.cli?.path}@${env.cli?.version}`)
  assert(env.state === 'ready', `expected state 'ready', got '${env.state}' (${env.error ?? ''})`)
  assert(!!env.account?.email, 'env.account.email is missing')
  assert(Array.isArray(env.models) && env.models.length > 0, 'env.models is empty')

  // 2. history.list()
  console.log('→ history.list()')
  const historyList = await win.evaluate(() => window.ember.history.list())
  assert(Array.isArray(historyList), 'history.list() did not return an array')
  console.log(`  ${historyList.length} sessions`)

  // 3. settings round-trip
  console.log('→ settings round-trip')
  const before = await win.evaluate(() => window.ember.settings.get())
  const toggled = await win.evaluate((v) => window.ember.settings.set({ showCost: v }), !before.showCost)
  assert(toggled.showCost === !before.showCost, 'settings.set did not persist the patch')
  await win.evaluate((v) => window.ember.settings.set({ showCost: v }), before.showCost) // restore
  console.log('  ok')

  // 4. files.suggest on the project root
  console.log('→ files.suggest(project root)')
  const suggestions = await win.evaluate((cwd) => window.ember.files.suggest(cwd, ''), process.cwd())
  assert(Array.isArray(suggestions) && suggestions.length > 0, 'files.suggest returned no results for the project root')
  console.log(`  ${suggestions.length} suggestions`)

  // 5. real session: PONG
  console.log('→ real session: PONG')
  const tmpDir1 = mkdtempSync(join(tmpdir(), 'ember-smoke-'))
  tmpDirs.push(tmpDir1)
  const chatId1 = randomUUID()
  await win.evaluate((id) => {
    window.__events = window.__events || {}
    window.__events[id] = []
    window.ember.session.onEvent((e) => {
      if (e.chatId === id) window.__events[id].push(e)
    })
  }, chatId1)

  const send1 = await win.evaluate(
    ({ chatId, cwd, uuid }) => window.ember.session.send({ chatId, cwd, model: 'haiku', text: 'Reply with exactly: PONG', uuid, permissionMode: 'default' }),
    { chatId: chatId1, cwd: tmpDir1, uuid: randomUUID() },
  )
  assert(send1.ok, `session.send failed: ${send1.error}`)

  await waitFor(async () => {
    const events = await win.evaluate((id) => window.__events[id], chatId1)
    return events.some((e) => e.kind === 'sdk' && e.message?.type === 'result')
  }, 90000, 'session result (PONG)')

  const events1 = await win.evaluate((id) => window.__events[id], chatId1)
  const assistantText = events1
    .filter((e) => e.kind === 'sdk' && e.message?.type === 'assistant')
    .flatMap((e) => (Array.isArray(e.message.message?.content) ? e.message.message.content : []))
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('')
  assert(assistantText.includes('PONG'), `assistant reply did not contain PONG: ${JSON.stringify(assistantText)}`)
  console.log(`  got: ${JSON.stringify(assistantText)}`)

  const sessionId1 = events1.find((e) => e.kind === 'session-id')?.sessionId
  if (sessionId1) sessionIdsToDelete.push(sessionId1)
  await win.evaluate((id) => window.ember.session.close(id), chatId1)

  // 6. permission round-trip: ask Claude to write a file, allow it, assert it exists
  console.log('→ permission round-trip')
  const tmpDir2 = mkdtempSync(join(tmpdir(), 'ember-smoke-'))
  tmpDirs.push(tmpDir2)
  const chatId2 = randomUUID()
  await win.evaluate((id) => {
    window.__events[id] = []
    window.ember.session.onEvent((e) => {
      if (e.chatId === id) window.__events[id].push(e)
    })
  }, chatId2)

  const send2 = await win.evaluate(
    ({ chatId, cwd, uuid }) =>
      window.ember.session.send({ chatId, cwd, model: 'haiku', text: 'Create a file named ok.txt containing hi', uuid, permissionMode: 'default' }),
    { chatId: chatId2, cwd: tmpDir2, uuid: randomUUID() },
  )
  assert(send2.ok, `session.send (permission test) failed: ${send2.error}`)

  await waitFor(async () => {
    const events = await win.evaluate((id) => window.__events[id], chatId2)
    return events.some((e) => e.kind === 'permission')
  }, 60000, 'permission request')

  const events2 = await win.evaluate((id) => window.__events[id], chatId2)
  const permRequest = events2.find((e) => e.kind === 'permission').request
  console.log(`  permission request: tool=${permRequest.toolName} title=${permRequest.title ?? ''}`)

  await win.evaluate((requestId) => window.ember.session.respond({ requestId, decision: 'allow' }), permRequest.requestId)

  await waitFor(async () => existsSync(join(tmpDir2, 'ok.txt')), 60000, 'ok.txt to be created')
  console.log('  ok.txt created — permission round-trip passed')

  await waitFor(async () => {
    const events = await win.evaluate((id) => window.__events[id], chatId2)
    return events.some((e) => e.kind === 'sdk' && e.message?.type === 'result')
  }, 60000, 'session result (permission test)')

  const sessionId2 = (await win.evaluate((id) => window.__events[id], chatId2)).find((e) => e.kind === 'session-id')?.sessionId
  if (sessionId2) sessionIdsToDelete.push(sessionId2)
  await win.evaluate((id) => window.ember.session.close(id), chatId2)

  console.log('ALL SMOKE TESTS PASSED')
} finally {
  // Clean up the temporary sessions this test created so they don't clutter the user's history.
  try {
    const win = await app.firstWindow()
    for (const sid of sessionIdsToDelete) {
      try {
        await win.evaluate((sid) => window.ember.history.delete(sid), sid)
        console.log(`cleaned up session ${sid}`)
      } catch (e) {
        console.log(`WARN: failed to delete session ${sid}: ${String(e)}`)
      }
    }
  } catch {
    // window may already be gone
  }
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
  await app.close()
}

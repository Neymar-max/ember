// Compatibility probe: runs Ember's exact query() options against a given claude executable.
// Usage: node scripts/compat-cli.mjs /path/to/claude [--no-thinking-display]
import { query, deleteSession } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const cli = process.argv[2]
const noTD = process.argv.includes('--no-thinking-display')
const cwd = mkdtempSync(join(tmpdir(), 'ember-compat-'))
const env = { ...process.env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT
let done = false
async function* input() {
  yield { type: 'user', message: { role: 'user', content: 'Reply with exactly: PONG' }, parent_tool_use_id: null, session_id: '' }
  while (!done) await new Promise((r) => setTimeout(r, 100))
}
const stderr = []
const t0 = Date.now()
const q = query({ prompt: input(), options: {
  pathToClaudeCodeExecutable: cli, cwd, env, model: 'haiku',
  systemPrompt: { type: 'preset', preset: 'claude_code' }, settingSources: ['user', 'project', 'local'],
  includePartialMessages: true, forwardSubagentText: true, agentProgressSummaries: true,
  toolConfig: { askUserQuestion: { previewFormat: 'html' } },
  ...(noTD ? {} : { extraArgs: { 'thinking-display': 'summarized' } }),
  canUseTool: async (n, i) => ({ behavior: 'allow', updatedInput: i }),
  stderr: (d) => stderr.push(d),
} })
let sid, text = '', result = null, err = null, init = null
const timer = setTimeout(() => { err = 'timeout 90s'; q.close() }, 90000)
try {
  init = await q.initializationResult().then((r) => ({ models: r.models?.length, account: !!r.account?.email }), (e) => ({ error: String(e) }))
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') sid = m.session_id
    if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') text += b.text
    if (m.type === 'result') { result = m.subtype; break }
  }
} catch (e) { err = String(e).slice(0, 300) }
clearTimeout(timer); done = true; q.close()
if (sid) await deleteSession(sid).catch(() => {})
console.log(JSON.stringify({ cli: cli.split('/').slice(-4).join('/'), noTD, ms: Date.now() - t0, init, result, pong: text.includes('PONG'), err, stderr: stderr.join('').slice(0, 300) }))
process.exit(0)

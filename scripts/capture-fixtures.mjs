// Captures raw SDK message streams for several scenarios into docs/fixtures/*.jsonl
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'docs/fixtures')
const CLI = join(homedir(), '.local/bin/claude')
const only = process.argv[2]

const scenarios = [
  { name: 'tools', prompt: 'In the current directory: 1) read package.json, 2) run `ls -la` with Bash, 3) create notes.txt containing "hi", 4) edit notes.txt to say "hello world", 5) grep for "name" in package.json. Be brief.', setup: d => writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2)) },
  { name: 'todo', prompt: 'Use your todo/task tracking tool to create a 3-item plan for writing a haiku, then mark each item done one by one (actually update the list each time). Finally write the haiku.' },
  { name: 'plan', prompt: 'Plan how to add a README.md for this empty project. Keep the plan very short (3 bullets). When ready, call ExitPlanMode.', mode: 'plan' },
  { name: 'ask', prompt: 'Before doing anything, use the AskUserQuestion tool to ask me (single question, 3 options) which language I prefer for a hello-world script. Then write the hello world in the chosen language as a code block (do not create files).' },
  { name: 'subagent', prompt: 'Use the Agent (Task) tool to launch one general-purpose subagent that runs `echo from-subagent` with Bash and reports back. Then summarize in one sentence.' },
  { name: 'markdown', prompt: 'Reply in Chinese with rich markdown: an H2 heading, a short paragraph with **bold**, `inline code` and a link to https://example.com, a bullet list, a numbered list, a table (3 cols x 3 rows), a python code block, a quote block, and a task list. No tools.' },
  { name: 'interrupt', prompt: 'Write a 400-word story about a lighthouse.', interruptAfterMs: 2500 },
]

for (const sc of scenarios) {
  if (only && sc.name !== only) continue
  const dir = mkdtempSync(join(tmpdir(), 'ember-fx-'))
  sc.setup?.(dir)
  const file = join(OUT, sc.name + '.jsonl')
  writeFileSync(file, '')
  const log = o => appendFileSync(file, JSON.stringify(o) + '\n')
  let push, done = false
  const queue = []
  async function* input() {
    yield { type: 'user', message: { role: 'user', content: sc.prompt }, parent_tool_use_id: null, session_id: '' }
    while (!done) await new Promise(r => setTimeout(r, 200))
  }
  const q = query({ prompt: input(), options: {
    pathToClaudeCodeExecutable: CLI, cwd: dir, model: 'haiku', includePartialMessages: true,
    permissionMode: sc.mode || 'default', settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    forwardSubagentText: true, toolConfig: { askUserQuestion: { previewFormat: 'html' } },
    env: { ...process.env, CLAUDECODE: undefined },
    canUseTool: async (toolName, inp, opts) => {
      const { signal, ...rest } = opts
      log({ __canUseTool: { toolName, input: inp, options: rest } })
      if (toolName === 'AskUserQuestion') {
        const q0 = inp.questions[0]
        return { behavior: 'allow', updatedInput: { ...inp, answers: { [q0.question]: q0.options[0].label } } }
      }
      if (toolName === 'ExitPlanMode') return { behavior: 'deny', message: 'User rejected the plan (capture run). Stop here.' }
      return { behavior: 'allow', updatedInput: inp }
    },
  } })
  if (sc.interruptAfterMs) setTimeout(() => q.interrupt().then(r => log({ __interrupt: r ?? null })).catch(e => log({ __interruptError: String(e) })), sc.interruptAfterMs)
  const t0 = Date.now()
  try {
    for await (const m of q) {
      log(m)
      if (m.type === 'result') break
    }
  } catch (e) { log({ __error: String(e) }) }
  done = true
  q.close()
  console.log(sc.name, 'done in', Date.now() - t0, 'ms ->', file)
}
process.exit(0)

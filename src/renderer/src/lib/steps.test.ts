import { describe, expect, it } from 'vitest'
import { summarizeSteps } from './steps'

const t = (k: string, v: Record<string, string | number> = {}) => `${k}(${Object.values(v).join(',')})`
const tc = (name: string, input: Record<string, unknown> = {}) => ({ id: name, name, input, status: 'done', parentToolUseId: null, children: [] }) as any

describe('summarizeSteps', () => {
  it('groups by kind in first-seen order', () => {
    expect(summarizeSteps([tc('Write', { file_path: '/a/.p.py' }), tc('Bash'), tc('Bash')], t)).toBe(
      'chat.steps.writeOne(.p.py)chat.steps.sep()chat.steps.bash.cont(2)',
    )
    expect(summarizeSteps([tc('Read', { file_path: '/x/a' }), tc('Read', { file_path: '/x/b' })], t)).toBe('chat.steps.read(2)')
  })
})

import { describe, expect, it } from 'vitest'
import { cleanUserText } from './userText'

describe('cleanUserText', () => {
  it('hides machine-only messages', () => {
    expect(cleanUserText('<task-notification>\n<task-id>a</task-id>\n</task-notification>').text).toBeNull()
    expect(cleanUserText('This session is being continued from a previous conversation that ran out…').text).toBeNull()
    expect(cleanUserText('<local-command-caveat>Caveat: x</local-command-caveat>').text).toBeNull()
    expect(cleanUserText('hi', { isCompactSummary: true }).text).toBeNull()
  })
  it('keeps only what was typed', () => {
    expect(cleanUserText('<system-reminder>x</system-reminder>你好').text).toBe('你好')
    expect(cleanUserText('<pasted_content id="5aba">\n认同\n</pasted_content id="5aba">').text).toBe('认同')
    expect(cleanUserText('[Image #2] 成功的弹窗').text).toBe('成功的弹窗')
    expect(cleanUserText('<copilot-context>\nNotes\n</copilot-context>\n\n<user-message>问题</user-message>').text).toBe('问题')
  })
  it('turns context files into attachments', () => {
    const r = cleanUserText('你好\n\n<linked_content path="世界模型思路讨论.md" />')
    expect(r).toEqual({ text: '你好', attachments: ['世界模型思路讨论.md'] })
    const s = cleanUserText('G1 是什么\n\n<editor_selection path="C.md" lines="34-34">\n<![CDATA[G1]]>\n</editor_selection>')
    expect(s).toEqual({ text: 'G1 是什么', attachments: ['C.md'] })
  })
})

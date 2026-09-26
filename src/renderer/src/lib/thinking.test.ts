import { describe, expect, it } from 'vitest'
import { thinkingHeadline } from './thinking'

describe('thinkingHeadline', () => {
  it('takes the first sentence, latest paragraph while streaming', () => {
    expect(thinkingHeadline('环境确认完毕：CLI 可用。接下来读文档。\n\n')).toBe('环境确认完毕：CLI 可用。')
    expect(thinkingHeadline('**Plan** first. More.\n\nNow testing it. Then x', true)).toBe('Now testing it.')
  })
})

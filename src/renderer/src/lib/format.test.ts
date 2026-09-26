import { describe, expect, it } from 'vitest'
import { displayPath, shortenPathsInText } from './format'

describe('path helpers', () => {
  it('shortens only at path boundaries', () => {
    expect(shortenPathsInText('ls -la /a/proj/src', '/a/proj')).toBe('ls -la src')
    expect(shortenPathsInText('cd /a/proj && ls', '/a/proj')).toBe('cd . && ls')
    expect(shortenPathsInText('cat /a/project2/x', '/a/proj')).toBe('cat /a/project2/x')
    expect(shortenPathsInText("ls '/a/proj'", '/a/proj')).toBe("ls '.'")
  })
  it('treats /private/var and /var as the same dir', () => {
    expect(displayPath('/private/var/folders/x/p/a.ts', '/var/folders/x/p')).toBe('a.ts')
    expect(shortenPathsInText('ls /private/var/folders/x/p/src', '/var/folders/x/p')).toBe('ls src')
  })
})

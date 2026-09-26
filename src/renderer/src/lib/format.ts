import { t } from '@/i18n'

export function basename(p: string): string {
  const s = p.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) || s : s
}

export function dirname(p: string): string {
  const s = p.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : '/'
}

let homeDir: string | undefined
/** Called once app info is known so path helpers can abbreviate the home directory. */
export function setHomeDir(home: string | undefined): void {
  homeDir = home?.replace(/\/+$/, '')
}

/** Replace the home directory prefix with ~ */
export function tildify(p: string, home: string | undefined = homeDir): string {
  if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length)
  return p
}

// macOS reports temp dirs both as /var/... and /private/var/... — treat them as the same place.
function variants(dir: string): string[] {
  const d = dir.replace(/\/+$/, '')
  if (d.startsWith('/private/')) return [d, d.slice('/private'.length)]
  if (/^\/(var|tmp|etc)\//.test(d)) return [d, '/private' + d]
  return [d]
}

/** Path relative to cwd when inside it, else tildified absolute path. */
export function displayPath(p: string, cwd?: string, home?: string): string {
  if (cwd) {
    for (const d of variants(cwd)) {
      if (p === d) return '.'
      if (p.startsWith(d + '/')) return p.slice(d.length + 1)
    }
  }
  return tildify(p, home ?? homeDir)
}

/** Shorten absolute paths inside free text (e.g. a shell command): cwd-relative, then ~ for home. */
export function shortenPathsInText(text: string, cwd?: string): string {
  let out = text
  if (cwd) {
    for (const d of variants(cwd).sort((a, b) => b.length - a.length)) {
      const esc = d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Only at a path boundary: "/a/proj/x" → "x", "/a/proj" → ".", but "/a/project2" stays intact.
      out = out.replace(new RegExp(esc + '/', 'g'), '').replace(new RegExp(esc + '(?=$|[\\s\'"`;|&)])', 'g'), '.')
    }
  }
  if (homeDir) out = out.split(homeDir + '/').join('~/')
  return out
}

export function relativeTime(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms)
  const m = Math.floor(d / 60000)
  if (m < 1) return t('common.justNow')
  if (m < 60) return t('common.minutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('common.hoursAgo', { n: h })
  return t('common.daysAgo', { n: Math.floor(h / 24) })
}

export type DateBucket = 'today' | 'yesterday' | 'previous7' | 'previous30' | 'older'
export function dateBucket(ms: number, now = new Date()): DateBucket {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86400000
  if (ms >= startOfToday) return 'today'
  if (ms >= startOfToday - day) return 'yesterday'
  if (ms >= startOfToday - 7 * day) return 'previous7'
  if (ms >= startOfToday - 30 * day) return 'previous30'
  return 'older'
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  if (m < 60) return `${m}m ${rs}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Guess a highlight.js language id from a file path. */
export function langFromPath(p: string): string | undefined {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', md: 'markdown', html: 'xml', xml: 'xml',
    svg: 'xml', css: 'css', scss: 'scss', less: 'less', sql: 'sql', lua: 'lua', r: 'r', dart: 'dart',
    vue: 'xml', dockerfile: 'dockerfile', makefile: 'makefile', tex: 'latex',
  }
  const base = basename(p).toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (base === 'makefile') return 'makefile'
  return map[ext]
}

export function uuid(): string {
  return crypto.randomUUID()
}

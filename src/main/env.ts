/**
 * Login-shell environment capture + child-process env construction.
 *
 * GUI apps launched from Finder/Dock inherit launchd's minimal PATH (roughly
 * `/usr/bin:/bin:/usr/sbin:/sbin`) and none of the user's shell-profile exports
 * (~/.local/bin, homebrew, nvm, ...). Everything the `claude` binary and the
 * Bash tools it spawns need has to come from a login-shell probe instead of
 * the Electron process's own `process.env`. See docs/research/packaging.md §4.
 */
import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { log } from './log'

const DELIMITER = '___EMBER_SHELL_ENV_DELIMITER___'
const TIMEOUT_MS = 6000

/** Env vars that must never leak from Ember's own process into the CLI child. */
const STRIP_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
]

type ClaudeJsonAuth = { customApiKeyResponses?: { approved?: string[]; rejected?: string[] }; oauthAccount?: unknown }
let claudeJsonCache: { mtimeMs: number; value: ClaudeJsonAuth } | null = null

// ~/.claude.json can be large and this runs on every session spawn — re-parse only when it changed.
function readClaudeJsonAuth(home: string): ClaudeJsonAuth | null {
  const file = join(home, '.claude.json')
  try {
    const { mtimeMs } = statSync(file)
    if (claudeJsonCache?.mtimeMs === mtimeMs) return claudeJsonCache.value
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as ClaudeJsonAuth
    const value = { customApiKeyResponses: cfg.customApiKeyResponses, oauthAccount: cfg.oauthAccount ? true : undefined }
    claudeJsonCache = { mtimeMs, value }
    return value
  } catch {
    return null
  }
}

/**
 * Mirrors the interactive CLI's decision about an ANTHROPIC_API_KEY exported by the shell profile.
 * In SDK/print mode the CLI would use such a key unconditionally, while the interactive CLI asks once
 * and remembers the answer in ~/.claude.json `customApiKeyResponses` (last 20 chars of the key).
 * Keep the key when the user approved it or has no OAuth login (API-key-only users); drop it when they
 * rejected it, or never answered but are logged in with a subscription — so Ember never silently bills
 * an API key the terminal CLI would not use. ANTHROPIC_AUTH_TOKEN (gateways/proxies) is always kept,
 * exactly as the CLI does.
 */
function shouldKeepApiKey(key: string, home: string): boolean {
  const cfg = readClaudeJsonAuth(home)
  if (!cfg) return true
  const suffix = key.slice(-20)
  if (cfg.customApiKeyResponses?.rejected?.includes(suffix)) return false
  if (cfg.customApiKeyResponses?.approved?.includes(suffix)) return true
  return !cfg.oauthAccount
}

let cachedShellEnv: NodeJS.ProcessEnv | null = null
let inflight: Promise<NodeJS.ProcessEnv> | null = null

function parseDelimited(stdout: string): NodeJS.ProcessEnv | null {
  const start = stdout.indexOf(DELIMITER)
  const end = stdout.lastIndexOf(DELIMITER)
  if (start === -1 || end === -1 || start === end) return null
  const body = stdout.slice(start + DELIMITER.length, end)
  const env: NodeJS.ProcessEnv = {}
  for (const line of body.split('\n')) {
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    // values may contain '=' themselves; multi-line values only keep their first line
    env[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return Object.keys(env).length > 0 ? env : null
}

function runShellEnv(shellPath: string): Promise<NodeJS.ProcessEnv | null> {
  return new Promise((resolve) => {
    const cmd = `printf "%s" "${DELIMITER}"; env; printf "%s" "${DELIMITER}"`
    let settled = false
    const child = execFile(
      shellPath,
      ['-ilc', cmd],
      { timeout: TIMEOUT_MS, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (error, stdout) => {
        if (settled) return
        settled = true
        if (error) resolve(null)
        else resolve(parseDelimited(stdout))
      },
    )
    child.on('error', () => {
      if (settled) return
      settled = true
      resolve(null)
    })
  })
}

/** Probes the user's login shell for its real env (PATH, HOME, etc). Cached after first success. */
export async function getLoginShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedShellEnv) return cachedShellEnv
  if (inflight) return inflight

  inflight = (async () => {
    const shell = process.env.SHELL || '/bin/zsh'
    const candidates = [shell, '/bin/zsh', '/bin/bash'].filter((s, i, arr) => arr.indexOf(s) === i)
    for (const shellPath of candidates) {
      const env = await runShellEnv(shellPath)
      if (env) {
        log.info(`login shell env captured via ${shellPath}`)
        cachedShellEnv = env
        return env
      }
    }
    log.warn('login shell env capture failed for all candidates; falling back to process.env')
    cachedShellEnv = process.env
    return process.env
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

function hasShimDir(dir: string): boolean {
  return dir.includes('/cmux-cli-shims')
}

function cleanPath(rawPath: string | undefined, home: string): string {
  const parts = (rawPath ?? '').split(':').filter((p) => p && !hasShimDir(p))
  const mustHave = [join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of mustHave) {
    if (!parts.includes(dir)) parts.push(dir)
  }
  return parts.join(':')
}

/**
 * Builds the env to pass as `Options.env` to the SDK: login-shell env merged
 * over `process.env`, with the must-have identity vars guaranteed, dangerous
 * vars stripped, and PATH repaired.
 */
export function buildChildEnv(shellEnv: NodeJS.ProcessEnv): Record<string, string> {
  const info = userInfo()
  const home = info.homedir || process.env.HOME || ''
  const merged: NodeJS.ProcessEnv = { ...process.env, ...shellEnv }

  merged.USER = merged.USER || info.username || process.env.USER || ''
  merged.LOGNAME = merged.LOGNAME || merged.USER
  merged.HOME = merged.HOME || home
  merged.SHELL = merged.SHELL || process.env.SHELL || '/bin/zsh'
  merged.LANG = merged.LANG || 'en_US.UTF-8'
  merged.PATH = cleanPath(merged.PATH, merged.HOME)

  for (const key of STRIP_VARS) delete merged[key]
  if (merged.ANTHROPIC_API_KEY && !shouldKeepApiKey(merged.ANTHROPIC_API_KEY, merged.HOME)) {
    delete merged.ANTHROPIC_API_KEY
    log.info('ANTHROPIC_API_KEY from the shell profile not passed to claude (CLI login is used instead)')
  }

  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/** Convenience: capture + build in one call, used at startup and on recheck. */
export async function getChildEnv(): Promise<Record<string, string>> {
  const shellEnv = await getLoginShellEnv()
  return buildChildEnv(shellEnv)
}

/** Forces the next `getLoginShellEnv()` call to re-probe (used by env:recheck). */
export function invalidateShellEnvCache(): void {
  cachedShellEnv = null
}

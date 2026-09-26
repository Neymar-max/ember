/**
 * Locates the `claude` executable to spawn, and validates it with `--version`.
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliInfo } from '@shared/types'
import { log } from './log'

const VERSION_TIMEOUT_MS = 5000
// e.g. "2.1.283 (Claude Code)"
const VERSION_RE = /^\d+\.\d+\.\d+\s*\(Claude Code\)/

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function checkVersion(path: string, env: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: VERSION_TIMEOUT_MS, env }, (error, stdout) => {
      if (error) return resolve(null)
      const text = stdout.trim()
      resolve(VERSION_RE.test(text) ? text : null)
    })
  })
}

/** `--thinking-display` only exists in newer CLIs (older ones abort with "unknown option"), so probe it once. */
function supportsFlag(path: string, env: Record<string, string>, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(path, [...args, '--version'], { timeout: VERSION_TIMEOUT_MS, env }, (error, stdout) => {
      resolve(!error && VERSION_RE.test(stdout.trim()))
    })
  })
}

function pathDirs(env: Record<string, string>): string[] {
  return (env.PATH ?? '').split(':').filter((d) => d && !d.includes('/cmux-cli-shims'))
}

/**
 * Finds and validates the `claude` executable, in the order specified by SPEC §2.3.
 * `env` must already be the constructed child env (login-shell PATH etc), see env.ts.
 */
export async function findCli(settingsCliPath: string, env: Record<string, string>): Promise<CliInfo> {
  const home = homedir()
  const candidates: Array<{ path: string; source: string }> = []

  if (settingsCliPath) candidates.push({ path: settingsCliPath, source: 'settings' })
  candidates.push({ path: join(home, '.local/bin/claude'), source: 'known-path' })
  candidates.push({ path: join(home, '.claude/local/claude'), source: 'known-path' })
  candidates.push({ path: '/opt/homebrew/bin/claude', source: 'known-path' })
  candidates.push({ path: '/usr/local/bin/claude', source: 'known-path' })
  for (const dir of pathDirs(env)) {
    candidates.push({ path: join(dir, 'claude'), source: 'login-shell' })
  }
  candidates.push({ path: join(home, '.npm-global/bin/claude'), source: 'known-path' })
  candidates.push({ path: join(home, '.volta/bin/claude'), source: 'known-path' })
  candidates.push({ path: join(home, '.bun/bin/claude'), source: 'known-path' })

  const seen = new Set<string>()
  for (const { path, source } of candidates) {
    if (seen.has(path)) continue
    seen.add(path)
    if (!(await isExecutable(path))) continue
    const versionText = await checkVersion(path, env)
    if (versionText) {
      const version = versionText.match(/\d+\.\d+\.\d+/)?.[0] ?? versionText
      const supportsThinkingDisplay = await supportsFlag(path, env, ['--thinking-display', 'summarized'])
      log.info(`CLI found: ${path} (${version}, via ${source}; thinking-display=${supportsThinkingDisplay})`)
      return { found: true, path, version, source, supportsThinkingDisplay }
    }
  }

  log.warn('CLI not found in any known location')
  return { found: false }
}

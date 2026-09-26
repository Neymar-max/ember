/**
 * Thin `child_process.spawn` wrapper passed as `Options.spawnClaudeCodeProcess`.
 * The SDK's default internal spawn behaves the same way, but wrapping it
 * ourselves is the only way to get a PID for the `close()` SIGKILL fallback
 * described in SPEC §2.5 (the SDK doesn't expose the child process otherwise).
 *
 * Tracked by a per-session `generation` id (not `chatId`) — a chatId can be
 * reused by a brand-new LiveSession (LRU eviction + resume) while the old
 * session's process is still winding down, and a chatId-keyed map would let
 * the old session's delayed cleanup kill/forget the new session's process.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'

const liveByGeneration = new Map<string, ChildProcess>()

/** Builds a `spawnClaudeCodeProcess` for one session generation, tracked for later PID lookup/kill. */
export function makeSpawner(generation: string): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
    })
    liveByGeneration.set(generation, child)
    child.once('exit', () => {
      if (liveByGeneration.get(generation) === child) liveByGeneration.delete(generation)
    })
    return child
  }
}

/** SIGKILLs the tracked child for `generation` if it's still alive. Used as `close()`'s final fallback. */
export function killIfAlive(generation: string, signal: NodeJS.Signals = 'SIGKILL'): void {
  const child = liveByGeneration.get(generation)
  if (child && child.exitCode === null && child.signalCode === null && child.pid) {
    try {
      process.kill(child.pid, signal)
    } catch {
      // already dead
    }
  }
  liveByGeneration.delete(generation)
}

/**
 * Polls (via the `process.kill(pid, 0)` existence check, every ~100ms) until the
 * tracked process for `generation` exits or `timeoutMs` elapses — resolving early
 * on exit. Used by `closeSession` to await graceful shutdown before SIGKILLing.
 */
export function waitForExit(generation: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const pid = liveByGeneration.get(generation)?.pid
    if (!pid) {
      resolve()
      return
    }
    const start = Date.now()
    const poll = (): void => {
      let alive = true
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
      }
      if (!alive || Date.now() - start >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(poll, 100)
    }
    poll()
  })
}

/** Synchronous last resort: SIGKILLs every still-tracked child. Used right before `app.quit()`. */
export function killAllTrackedSync(): void {
  for (const [generation, child] of liveByGeneration) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        // already dead
      }
    }
  }
  liveByGeneration.clear()
}

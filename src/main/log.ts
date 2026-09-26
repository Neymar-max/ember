/**
 * File logger for the main process. Never logs message content or credentials —
 * only lifecycle events, paths, and short diagnostic strings (see call sites).
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOG_DIR = join(homedir(), 'Library/Logs/Ember')
const LOG_FILE = join(LOG_DIR, 'main.log')
const MAX_BYTES = 5 * 1024 * 1024

let ready = false

function ensureReady(): void {
  if (ready) return
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`)
    }
  } catch {
    // best-effort; if we can't set up the log dir we just stop logging
  }
  ready = true
}

function write(level: string, msg: string): void {
  ensureReady()
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [${level}] ${msg}\n`)
  } catch {
    // logging must never crash the app
  }
}

export const log = {
  info: (msg: string): void => write('INFO', msg),
  warn: (msg: string): void => write('WARN', msg),
  error: (msg: string): void => write('ERROR', msg),
}

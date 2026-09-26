/**
 * Persisted app settings: userData/settings.json, merged with DEFAULT_SETTINGS.
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { log } from './log'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let current: AppSettings = DEFAULT_SETTINGS
let loaded = false

function load(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persist(settings: AppSettings): void {
  try {
    const p = settingsPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(settings, null, 2))
  } catch (e) {
    log.error(`failed to write settings.json: ${String(e)}`)
  }
}

export function getSettings(): AppSettings {
  if (!loaded) {
    current = load()
    loaded = true
  }
  return current
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  current = { ...getSettings(), ...patch }
  persist(current)
  return current
}

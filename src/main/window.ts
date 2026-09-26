/**
 * Main window creation, security policy, and bounds persistence. See SPEC §2.1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import type { AppSettings } from '@shared/types'
import { log } from './log'

interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

const DEFAULT_BOUNDS: WindowBounds = { width: 1280, height: 840 }

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadBounds(): WindowBounds {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<WindowBounds>
    return { ...DEFAULT_BOUNDS, ...parsed }
  } catch {
    return { ...DEFAULT_BOUNDS }
  }
}

function saveBounds(win: BrowserWindow): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(statePath(), JSON.stringify(win.getBounds()))
  } catch (e) {
    log.warn(`failed to save window state: ${String(e)}`)
  }
}

function resolvePreloadPath(): string {
  const cjs = join(__dirname, '../preload/index.js')
  const mjs = join(__dirname, '../preload/index.mjs')
  return existsSync(cjs) ? cjs : existsSync(mjs) ? mjs : cjs
}

export function backgroundColorFor(settings: AppSettings): string {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#262624' : '#f5f4ed'
}

export function createMainWindow(settings: AppSettings): BrowserWindow {
  const bounds = loadBounds()
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 880,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 17 },
    backgroundColor: backgroundColorFor(settings),
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.on('close', () => saveBounds(win))

  // Security: only allow http/https/mailto to open externally; deny opening a new BrowserWindow,
  // and block all in-app navigation (the renderer is a single-page app and never needs a full navigate).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // DevTools stay out of the production menu, but ⌥⌘I still opens them (SPEC §2.1).
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.alt && input.meta && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

export function updateBackgroundColor(win: BrowserWindow, settings: AppSettings): void {
  if (!win.isDestroyed()) win.setBackgroundColor(backgroundColorFor(settings))
}

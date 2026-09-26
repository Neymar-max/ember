/**
 * `sys:*` IPC handlers: dialogs, Finder/Terminal integration, notifications, dock badge.
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { extname } from 'node:path'
import { app, BrowserWindow, dialog, Notification, shell, type OpenDialogOptions } from 'electron'
import type { AppInfo, ImageAttachment } from '@shared/types'
import { IPC } from '@shared/ipc'
import { log } from './log'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MEDIA_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

let getWindow: () => BrowserWindow | null = () => null

export function initSys(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const win = getWindow()
  const result = win
    ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export async function pickImages(): Promise<ImageAttachment[]> {
  const win = getWindow()
  const opts: OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled) return []

  const attachments: ImageAttachment[] = []
  for (const path of result.filePaths) {
    try {
      if (statSync(path).size > MAX_IMAGE_BYTES) continue
      const ext = extname(path).slice(1).toLowerCase()
      const mediaType = MEDIA_TYPES[ext]
      if (!mediaType) continue
      const buf = await readFile(path)
      attachments.push({ mediaType, data: buf.toString('base64'), name: path.split('/').pop() })
    } catch (e) {
      log.warn(`pickImages: failed to read ${path}: ${String(e)}`)
    }
  }
  return attachments
}

export async function pickExecutable(): Promise<string | null> {
  const win = getWindow()
  const opts: OpenDialogOptions = { properties: ['openFile'] }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export async function openExternal(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return
    await shell.openExternal(url)
  } catch {
    // malformed URL — ignore
  }
}

export function showInFinder(path: string): void {
  shell.showItemInFolder(path)
}

function shellEscapeSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function openInTerminal(cwd: string, command?: string): void {
  if (!command) {
    execFile('open', ['-a', 'Terminal', cwd], (error) => {
      if (error) log.warn(`openInTerminal (no command) failed: ${String(error)}`)
    })
    return
  }
  const script = `cd ${shellEscapeSingleQuoted(cwd)} && ${command}`
  execFile(
    'osascript',
    ['-e', `tell application "Terminal" to do script ${JSON.stringify(script)}`, '-e', 'tell application "Terminal" to activate'],
    (error) => {
      if (error) log.warn(`openInTerminal (with command) failed: ${String(error)}`)
    },
  )
}

export async function openPath(path: string): Promise<void> {
  const error = await shell.openPath(path)
  if (error) log.warn(`openPath failed for ${path}: ${error}`)
}

export function notify(title: string, body: string, chatId?: string): void {
  const win = getWindow()
  if (win && win.isFocused()) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => {
    const w = getWindow()
    if (w && !w.isDestroyed()) {
      w.show()
      w.focus()
      w.webContents.send(IPC.notificationClicked, chatId)
    }
  })
  n.show()
}

export function setBadge(count: number): void {
  if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '')
}

export function appInfo(): AppInfo {
  const info = userInfo()
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    userName: info.username,
    homeDir: info.homedir || homedir(),
  }
}

export function pathExists(path: string): boolean {
  return existsSync(path)
}

/**
 * Registers every `ipcMain.handle` channel declared in `@shared/ipc`.
 * Every handler is wrapped in try/catch and returns a safe fallback — an
 * exception here must never crash the main process (SPEC §2.7).
 */
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { DEFAULT_SETTINGS, type AppSettings, type EffortChoice, type PermissionMode, type PermissionResponse, type SendPayload, type StartOptions } from '@shared/types'
import { suggestFiles, readPreview, recentFiles } from './files'
import * as history from './history'
import { log } from './log'
import { getEnvStatus, recheckEnv } from './probe'
import * as sessions from './sessions'
import { getSettings, setSettings } from './settings'
import * as sys from './sys'
import { refreshPlanUsage } from './usage'

export interface IpcContext {
  onSettingsChanged: (patch: Partial<AppSettings>) => void
}

function fail(channel: string, e: unknown): void {
  log.error(`IPC ${channel} failed: ${e instanceof Error ? e.message : String(e)}`)
}

export function registerIpcHandlers(ctx: IpcContext): void {
  // env
  ipcMain.handle(IPC.envGet, async () => {
    try {
      return await getEnvStatus()
    } catch (e) {
      fail(IPC.envGet, e)
      return { state: 'error' as const, cli: { found: false }, models: [], commands: [], error: String(e), checkedAt: Date.now() }
    }
  })
  ipcMain.handle(IPC.envRecheck, async () => {
    try {
      return await recheckEnv()
    } catch (e) {
      fail(IPC.envRecheck, e)
      return { state: 'error' as const, cli: { found: false }, models: [], commands: [], error: String(e), checkedAt: Date.now() }
    }
  })
  ipcMain.handle(IPC.usageRefresh, async () => {
    try {
      return await refreshPlanUsage()
    } catch (e) {
      fail(IPC.usageRefresh, e)
      return sessions.getLatestRateLimits()
    }
  })
  ipcMain.handle(IPC.rateLimitsGet, () => {
    try {
      return sessions.getLatestRateLimits()
    } catch (e) {
      fail(IPC.rateLimitsGet, e)
      return null
    }
  })

  // settings
  ipcMain.handle(IPC.settingsGet, () => {
    try {
      return getSettings()
    } catch (e) {
      fail(IPC.settingsGet, e)
      return DEFAULT_SETTINGS
    }
  })
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    try {
      const next = setSettings(patch)
      ctx.onSettingsChanged(patch)
      return next
    } catch (e) {
      fail(IPC.settingsSet, e)
      return getSettings()
    }
  })

  // history
  ipcMain.handle(IPC.historyList, async (_e, opts?: { limit?: number }) => {
    try {
      return await history.listHistory(opts)
    } catch (e) {
      fail(IPC.historyList, e)
      return []
    }
  })
  ipcMain.handle(IPC.historyLoad, async (_e, sessionId: string) => {
    try {
      return await history.loadHistory(sessionId)
    } catch (e) {
      fail(IPC.historyLoad, e)
      return { sessionId, title: '未命名', messages: [] }
    }
  })
  ipcMain.handle(IPC.historyRename, async (_e, sessionId: string, title: string) => {
    try {
      await history.renameHistory(sessionId, title)
    } catch (e) {
      fail(IPC.historyRename, e)
    }
  })
  ipcMain.handle(IPC.historyDelete, async (_e, sessionId: string) => {
    try {
      await history.deleteHistory(sessionId)
    } catch (e) {
      fail(IPC.historyDelete, e)
    }
  })

  // live sessions
  ipcMain.handle(IPC.sessionStart, async (_e, opts: StartOptions) => {
    try {
      return await sessions.startSession(opts)
    } catch (e) {
      fail(IPC.sessionStart, e)
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.sessionSend, async (_e, payload: SendPayload) => {
    try {
      return await sessions.sendMessage(payload)
    } catch (e) {
      fail(IPC.sessionSend, e)
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(IPC.sessionInterrupt, async (_e, chatId: string) => {
    try {
      await sessions.interruptSession(chatId)
    } catch (e) {
      fail(IPC.sessionInterrupt, e)
    }
  })
  ipcMain.handle(IPC.sessionSetModel, async (_e, chatId: string, model?: string) => {
    try {
      await sessions.setModel(chatId, model)
    } catch (e) {
      fail(IPC.sessionSetModel, e)
    }
  })
  ipcMain.handle(IPC.sessionSetPermissionMode, async (_e, chatId: string, mode: PermissionMode) => {
    try {
      await sessions.setPermissionMode(chatId, mode)
    } catch (e) {
      fail(IPC.sessionSetPermissionMode, e)
    }
  })
  ipcMain.handle(IPC.sessionSetEffort, async (_e, chatId: string, effort: EffortChoice | null) => {
    try {
      await sessions.setEffort(chatId, effort)
    } catch (e) {
      fail(IPC.sessionSetEffort, e)
    }
  })
  ipcMain.handle(IPC.sessionClose, async (_e, chatId: string) => {
    try {
      await sessions.closeSession(chatId)
    } catch (e) {
      fail(IPC.sessionClose, e)
    }
  })
  ipcMain.handle(IPC.sessionRespond, (_e, resp: PermissionResponse) => {
    try {
      sessions.respondPermission(resp)
    } catch (e) {
      fail(IPC.sessionRespond, e)
    }
  })
  ipcMain.handle(IPC.sessionPending, () => {
    try {
      return sessions.listPending()
    } catch (e) {
      fail(IPC.sessionPending, e)
      return []
    }
  })
  ipcMain.handle(IPC.sessionMeta, async (_e, chatId: string) => {
    try {
      return await sessions.getSessionMeta(chatId)
    } catch (e) {
      fail(IPC.sessionMeta, e)
      return null
    }
  })
  ipcMain.handle(IPC.sessionContextUsage, async (_e, chatId: string) => {
    try {
      return await sessions.getContextUsage(chatId)
    } catch (e) {
      fail(IPC.sessionContextUsage, e)
      return null
    }
  })
  ipcMain.handle(IPC.sessionLiveList, () => {
    try {
      return sessions.liveList()
    } catch (e) {
      fail(IPC.sessionLiveList, e)
      return []
    }
  })

  // files & system
  ipcMain.handle(IPC.filesSuggest, async (_e, cwd: string, query: string) => {
    try {
      return await suggestFiles(cwd, query)
    } catch (e) {
      fail(IPC.filesSuggest, e)
      return []
    }
  })
  ipcMain.handle(IPC.filesRead, async (_e, path: string, cwd?: string) => readPreview(path, cwd))
  ipcMain.handle(IPC.filesRecent, async (_e, cwd: string, sinceMs: number) => {
    try {
      return await recentFiles(cwd, sinceMs)
    } catch (e) {
      fail(IPC.filesRecent, e)
      return []
    }
  })
  ipcMain.handle(IPC.pickDirectory, async (_e, defaultPath?: string) => {
    try {
      return await sys.pickDirectory(defaultPath)
    } catch (e) {
      fail(IPC.pickDirectory, e)
      return null
    }
  })
  ipcMain.handle(IPC.pickImages, async () => {
    try {
      return await sys.pickImages()
    } catch (e) {
      fail(IPC.pickImages, e)
      return []
    }
  })
  ipcMain.handle(IPC.pickExecutable, async () => {
    try {
      return await sys.pickExecutable()
    } catch (e) {
      fail(IPC.pickExecutable, e)
      return null
    }
  })
  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    try {
      await sys.openExternal(url)
    } catch (e) {
      fail(IPC.openExternal, e)
    }
  })
  ipcMain.handle(IPC.showInFinder, (_e, path: string) => {
    try {
      sys.showInFinder(path)
    } catch (e) {
      fail(IPC.showInFinder, e)
    }
  })
  ipcMain.handle(IPC.openInTerminal, (_e, cwd: string, command?: string) => {
    try {
      sys.openInTerminal(cwd, command)
    } catch (e) {
      fail(IPC.openInTerminal, e)
    }
  })
  ipcMain.handle(IPC.openPath, async (_e, path: string) => {
    try {
      await sys.openPath(path)
    } catch (e) {
      fail(IPC.openPath, e)
    }
  })
  ipcMain.handle(IPC.notify, (_e, title: string, body: string, chatId?: string) => {
    try {
      sys.notify(title, body, chatId)
    } catch (e) {
      fail(IPC.notify, e)
    }
  })
  ipcMain.handle(IPC.setBadge, (_e, count: number) => {
    try {
      sys.setBadge(count)
    } catch (e) {
      fail(IPC.setBadge, e)
    }
  })
  ipcMain.handle(IPC.appInfo, () => {
    try {
      return sys.appInfo()
    } catch (e) {
      fail(IPC.appInfo, e)
      return { version: '', platform: process.platform, arch: process.arch, locale: 'en', userName: '', homeDir: '' }
    }
  })
  ipcMain.handle(IPC.pathExists, (_e, path: string) => {
    try {
      return sys.pathExists(path)
    } catch (e) {
      fail(IPC.pathExists, e)
      return false
    }
  })
}

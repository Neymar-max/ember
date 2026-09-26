/**
 * Main process entry: single-instance lock, window/menu lifecycle, and wiring
 * between settings, env probing, the session manager, and IPC. See SPEC §2.
 */
import { app, BrowserWindow, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc'
import { invalidateListCache } from './history'
import { registerIpcHandlers } from './ipc'
import { log } from './log'
import { applyMenu } from './menu'
import { onEnvChanged, recheckEnv } from './probe'
import { closeAllSessions, configureSessionManager, killAllOrphanProcesses } from './sessions'
import { getSettings } from './settings'
import { initSys, notify, setBadge } from './sys'
import { backgroundColorFor, createMainWindow, updateBackgroundColor } from './window'

const QUIT_TIMEOUT_MS = 3000

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let quitting = false

  function broadcast(channel: string, payload?: unknown): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    log.info(`Ember starting (app version ${app.getVersion()}, electron ${process.versions.electron})`)

    const settings = getSettings()
    applyMenu(settings.language)
    initSys(() => mainWindow)

    configureSessionManager({
      onEvent: (e) => broadcast(IPC.sessionEvent, e),
      onRateLimits: (r) => broadcast(IPC.rateLimits, r),
      onHistoryChanged: () => {
        invalidateListCache()
        broadcast(IPC.historyChanged)
      },
      notify: (title, body, chatId) => notify(title, body, chatId),
      setBadge: (count) => setBadge(count),
    })

    onEnvChanged((status) => broadcast(IPC.envChanged, status))

    mainWindow = createMainWindow(settings)

    registerIpcHandlers({
      onSettingsChanged: (patch) => {
        const next = getSettings()
        if (patch.cliPath !== undefined) void recheckEnv()
        if (patch.language !== undefined) applyMenu(next.language)
        if (patch.theme !== undefined && mainWindow) updateBackgroundColor(mainWindow, next)
        broadcast(IPC.settingsChanged, next)
      },
    })

    // kick off the initial CLI detection + login probe; env:get will await it if still running
    void recheckEnv()

    nativeTheme.on('updated', () => {
      if (mainWindow) mainWindow.setBackgroundColor(backgroundColorFor(getSettings()))
    })
  })

  app.on('window-all-closed', () => {
    // macOS convention: keep the app running with no windows, reopen via dock click
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(getSettings())
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    log.info('quitting: closing all live sessions')
    void closeAllSessions(QUIT_TIMEOUT_MS)
      .finally(() => killAllOrphanProcesses())
      .finally(() => app.quit())
  })
}

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type EmberAPI } from '../shared/ipc'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: EmberAPI = {
  env: {
    get: () => invoke(IPC.envGet),
    recheck: () => invoke(IPC.envRecheck),
    onChanged: (cb) => subscribe(IPC.envChanged, cb),
    getRateLimits: () => invoke(IPC.rateLimitsGet),
    refreshUsage: () => invoke(IPC.usageRefresh),
    onRateLimits: (cb) => subscribe(IPC.rateLimits, cb),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    set: (patch) => invoke(IPC.settingsSet, patch),
    onChanged: (cb) => subscribe(IPC.settingsChanged, cb),
  },
  history: {
    list: (opts) => invoke(IPC.historyList, opts),
    load: (sessionId) => invoke(IPC.historyLoad, sessionId),
    rename: (sessionId, title) => invoke(IPC.historyRename, sessionId, title),
    delete: (sessionId) => invoke(IPC.historyDelete, sessionId),
    onChanged: (cb) => subscribe(IPC.historyChanged, () => cb()),
  },
  session: {
    start: (opts) => invoke(IPC.sessionStart, opts),
    send: (payload) => invoke(IPC.sessionSend, payload),
    interrupt: (chatId) => invoke(IPC.sessionInterrupt, chatId),
    setModel: (chatId, model) => invoke(IPC.sessionSetModel, chatId, model),
    setPermissionMode: (chatId, mode) => invoke(IPC.sessionSetPermissionMode, chatId, mode),
    setEffort: (chatId, effort) => invoke(IPC.sessionSetEffort, chatId, effort),
    close: (chatId) => invoke(IPC.sessionClose, chatId),
    respond: (resp) => invoke(IPC.sessionRespond, resp),
    pending: () => invoke(IPC.sessionPending),
    meta: (chatId) => invoke(IPC.sessionMeta, chatId),
    contextUsage: (chatId) => invoke(IPC.sessionContextUsage, chatId),
    liveList: () => invoke(IPC.sessionLiveList),
    onEvent: (cb) => subscribe(IPC.sessionEvent, cb),
  },
  files: {
    suggest: (cwd, query) => invoke(IPC.filesSuggest, cwd, query),
    read: (path, cwd) => invoke(IPC.filesRead, path, cwd),
    recent: (cwd, sinceMs) => invoke(IPC.filesRecent, cwd, sinceMs),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
  },
  sys: {
    pickDirectory: (defaultPath) => invoke(IPC.pickDirectory, defaultPath),
    pickImages: () => invoke(IPC.pickImages),
    pickExecutable: () => invoke(IPC.pickExecutable),
    openExternal: (url) => invoke(IPC.openExternal, url),
    showInFinder: (path) => invoke(IPC.showInFinder, path),
    openInTerminal: (cwd, command) => invoke(IPC.openInTerminal, cwd, command),
    openPath: (path) => invoke(IPC.openPath, path),
    notify: (title, body, chatId) => invoke(IPC.notify, title, body, chatId),
    setBadge: (count) => invoke(IPC.setBadge, count),
    appInfo: () => invoke(IPC.appInfo),
    pathExists: (path) => invoke(IPC.pathExists, path),
    onMenuCommand: (cb) => subscribe(IPC.menuCommand, cb),
    onNotificationClicked: (cb) => subscribe(IPC.notificationClicked, cb),
  },
}

contextBridge.exposeInMainWorld('ember', api)

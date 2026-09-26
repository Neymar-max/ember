/**
 * Application menu (zh/en, following settings.language or the system locale).
 * Custom commands are sent to the focused renderer over IPC.menuCommand;
 * `interrupt` is deliberately not wired here — the renderer handles Esc itself (SPEC §2.1).
 */
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc'
import type { LanguageSetting, MenuCommand } from '@shared/types'

const LABELS = {
  zh: {
    about: '关于 Ember',
    settings: '设置…',
    hide: '隐藏 Ember',
    hideOthers: '隐藏其他',
    unhide: '显示全部',
    quit: '退出 Ember',
    file: '文件',
    newChat: '新对话',
    openProject: '打开项目文件夹…',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    toggleSidebar: '切换侧边栏',
    search: '搜索对话',
    focusComposer: '聚焦输入框',
    actualSize: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    devTools: '开发者工具',
    window: '窗口',
    minimize: '最小化',
    zoom: '缩放',
    help: '帮助',
  },
  en: {
    about: 'About Ember',
    settings: 'Settings…',
    hide: 'Hide Ember',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit Ember',
    file: 'File',
    newChat: 'New Chat',
    openProject: 'Open Project Folder…',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    toggleSidebar: 'Toggle Sidebar',
    search: 'Search Chats',
    focusComposer: 'Focus Composer',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    devTools: 'Developer Tools',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    help: 'Help',
  },
} as const

type Labels = Record<keyof typeof LABELS.zh, string>

function resolveLang(setting: LanguageSetting): 'zh' | 'en' {
  if (setting === 'zh' || setting === 'en') return setting
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function sendCommand(cmd: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.send(IPC.menuCommand, cmd)
}

function buildTemplate(t: Labels): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about', label: t.about },
      { type: 'separator' },
      { label: t.settings, accelerator: 'Cmd+,', click: () => sendCommand('open-settings') },
      { type: 'separator' },
      { role: 'hide', label: t.hide },
      { role: 'hideOthers', label: t.hideOthers },
      { role: 'unhide', label: t.unhide },
      { type: 'separator' },
      { role: 'quit', label: t.quit },
    ],
  }

  const fileMenu: MenuItemConstructorOptions = {
    label: t.file,
    submenu: [
      { label: t.newChat, accelerator: 'Cmd+N', click: () => sendCommand('new-chat') },
      { label: t.openProject, accelerator: 'Cmd+O', click: () => sendCommand('open-project') },
    ],
  }

  const editMenu: MenuItemConstructorOptions = {
    label: t.edit,
    submenu: [
      { role: 'undo', label: t.undo },
      { role: 'redo', label: t.redo },
      { type: 'separator' },
      { role: 'cut', label: t.cut },
      { role: 'copy', label: t.copy },
      { role: 'paste', label: t.paste },
      { role: 'selectAll', label: t.selectAll },
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      { label: t.toggleSidebar, accelerator: 'Cmd+B', click: () => sendCommand('toggle-sidebar') },
      { label: t.search, accelerator: 'Cmd+K', click: () => sendCommand('focus-search') },
      { label: t.focusComposer, accelerator: 'Cmd+L', click: () => sendCommand('focus-composer') },
      { type: 'separator' },
      { role: 'resetZoom', label: t.actualSize },
      { role: 'zoomIn', label: t.zoomIn },
      { role: 'zoomOut', label: t.zoomOut },
      { type: 'separator' },
      { role: 'toggleDevTools', label: t.devTools, visible: !app.isPackaged },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: t.window,
    submenu: [
      { role: 'minimize', label: t.minimize },
      { role: 'zoom', label: t.zoom },
    ],
  }

  const helpMenu: MenuItemConstructorOptions = { label: t.help, submenu: [] }

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
}

export function applyMenu(language: LanguageSetting): void {
  const t = LABELS[resolveLang(language)]
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(t)))
}

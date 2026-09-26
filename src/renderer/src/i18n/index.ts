/**
 * Tiny i18n. Each area owns one dictionary file (common/chat/tools/shell) exporting
 * `{ zh: {...}, en: {...} }` with keys prefixed by the area name, e.g. 'tools.bash.title'.
 * Placeholders: '{name}' → t('key', { name: 'x' }).
 * Usage: in components call `const t = useT()`; outside React call `t()` directly.
 */
import { create } from 'zustand'
import common from './common'
import chat from './chat'
import tools from './tools'
import shell from './shell'

export type Lang = 'zh' | 'en'
type Dict = Record<string, string>

const dicts: Record<Lang, Dict> = {
  zh: { ...common.zh, ...chat.zh, ...tools.zh, ...shell.zh },
  en: { ...common.en, ...chat.en, ...tools.en, ...shell.en },
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
  setLang: (lang) => set({ lang }),
}))

export function resolveLang(setting: 'zh' | 'en' | 'system'): Lang {
  if (setting !== 'system') return setting
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function format(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useLang.getState().lang
  const s = dicts[lang][key] ?? dicts.en[key] ?? dicts.zh[key] ?? key
  return format(s, vars)
}

/** Hook: re-renders the component when the language changes. */
export function useT(): typeof t {
  useLang((s) => s.lang)
  return t
}

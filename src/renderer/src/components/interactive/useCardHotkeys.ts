import { useEffect } from 'react'

/**
 * Enter → onEnter(), Esc → onEscape() — but only while the dock card is visible and the
 * user isn't typing somewhere else (the composer, the sidebar search, …), per SPEC 4.3:
 * "keyboard shortcuts only apply while the card is visible and focus isn't in another text
 * input (except when that input is empty)". A focused <input> or <textarea> with content
 * blocks the shortcut; an empty one (including the composer, which is a <textarea>) doesn't.
 */
export function useCardHotkeys(active: boolean, handlers: { onEnter?: () => void; onEscape?: () => void }): void {
  const { onEnter, onEscape } = handlers
  useEffect(() => {
    if (!active) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.isComposing) return
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
      const tag = el?.tagName
      // A focused, non-empty text input blocks the shortcut; an empty one (including the
      // composer's <textarea>) doesn't — SPEC 4.3 "Composer 为空时也允许".
      if ((tag === 'TEXTAREA' || tag === 'INPUT') && (el?.value ?? '').length > 0) return
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && onEnter) {
        e.preventDefault()
        onEnter()
      } else if (e.key === 'Escape' && onEscape) {
        e.preventDefault()
        onEscape()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, onEnter, onEscape])
}

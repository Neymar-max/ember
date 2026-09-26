import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import './Popover.css'

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** element the popover is positioned against */
  anchorRef: RefObject<HTMLElement | null>
  placement?: Placement
  offset?: number
  /** fixed width; omitted = match anchor width */
  width?: number
  matchAnchorWidth?: boolean
  className?: string
  /** ARIA role of the panel: 'menu' for lists of actions, 'dialog' for panels with form controls */
  role?: 'menu' | 'dialog'
  children: ReactNode
}

/**
 * Minimal floating panel: fixed-position, portaled to <body>, closes on outside click / Esc.
 * Positioning is recomputed on open/resize/scroll — no popper dependency, per the "no new deps" rule.
 */
export function Popover({ open, onClose, anchorRef, placement = 'bottom-start', offset = 6, width, matchAnchorWidth, className, role = 'menu', children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const a = anchorRef.current
      const el = ref.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const w = width ?? (matchAnchorWidth ? r.width : el?.offsetWidth ?? 200)
      let top = r.bottom + offset
      let left = r.left
      if (placement.startsWith('top')) top = r.top - offset - (el?.offsetHeight ?? 0)
      if (placement.endsWith('end')) left = r.right - w
      if (placement === 'bottom' || placement === 'top') left = r.left + r.width / 2 - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      top = Math.max(8, Math.min(top, window.innerHeight - 8))
      setPos({ top, left, width: width ?? (matchAnchorWidth ? w : undefined) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, offset, width, matchAnchorWidth])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={clsx('em-ui-popover', className)}
      role={role}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

export interface MenuItemProps {
  icon?: ReactNode
  label: ReactNode
  description?: ReactNode
  hint?: ReactNode
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}

/** A single row inside a Popover — icon, label(+description), optional trailing hint/check. */
export function MenuItem({ icon, label, description, hint, active, danger, disabled, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx('em-ui-menu-item', active && 'is-active', danger && 'em-ui-menu-item--danger')}
      disabled={disabled}
      onClick={(e) => {
        // Popovers are portaled to <body>, but React still bubbles synthetic events along the
        // component tree — without this, selecting an item also fires whatever onClick the
        // anchor's ancestor has (e.g. a sidebar row opening/closing behind the menu).
        e.stopPropagation()
        onSelect?.()
      }}
    >
      {icon && <span className="em-ui-menu-item__icon">{icon}</span>}
      <span className="em-ui-menu-item__body">
        <span className="em-ui-menu-item__label">{label}</span>
        {description != null && <span className="em-ui-menu-item__desc">{description}</span>}
      </span>
      {hint != null && <span className="em-ui-menu-item__hint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="em-ui-menu-sep" role="separator" />
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="em-ui-menu-heading">{children}</div>
}

import clsx from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n'
import { Button } from './Button'
import './Dialog.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  width?: number
  className?: string
  labelledBy?: string
  children: ReactNode
}

/** Centered modal: overlay click and Esc both close (capture-phase, so it wins over any global Esc handler). */
export function Dialog({ open, onClose, width = 560, className, labelledBy, children }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="em-ui-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={clsx('em-ui-dialog em-selectable', className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
        // Dialogs are portaled to <body>, but React still bubbles synthetic events along the
        // component tree — without this, a click anywhere inside (e.g. a ConfirmDialog button)
        // also fires whatever onClick the trigger's ancestor has (a sidebar row's open handler).
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function DialogHeader({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="em-ui-dialog__header">
      <div id={id} className="em-ui-dialog__title">
        {children}
      </div>
    </div>
  )
}
export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="em-ui-dialog__body">{children}</div>
}
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="em-ui-dialog__footer">{children}</div>
}

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Small "are you sure" dialog for destructive or high-stakes confirmations (delete, bypass permissions…). */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, danger = true, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onClose={onCancel} width={420} labelledBy="em-confirm-title">
      <DialogBody>
        <div className={clsx('em-ui-confirm__icon', !danger && 'em-ui-confirm__icon--neutral')}>
          <AlertTriangle size={20} strokeWidth={1.75} />
        </div>
        <div id="em-confirm-title" style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
          {title}
        </div>
        {description != null && <div>{description}</div>}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
            onCancel()
          }}
        >
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={(e) => {
            e.stopPropagation()
            onConfirm()
          }}
          disabled={busy}
        >
          {confirmLabel ?? t('common.delete')}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

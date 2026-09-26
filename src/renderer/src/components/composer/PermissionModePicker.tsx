/** Permission-mode pill: default / acceptEdits / plan / auto / bypassPermissions (§4.4). */
import clsx from 'clsx'
import { Ban, CheckCircle2, ChevronDown, ClipboardList, ShieldCheck, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/common/Dialog'
import { MenuItem, Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import type { PermissionMode } from '@shared/types'

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']

const ICONS: Record<PermissionMode, typeof ShieldCheck> = {
  default: ShieldCheck,
  acceptEdits: CheckCircle2,
  plan: ClipboardList,
  auto: Zap,
  dontAsk: CheckCircle2,
  bypassPermissions: Ban,
}

function toneClass(mode: PermissionMode): string | undefined {
  if (mode === 'bypassPermissions') return 'em-composer__pill--danger'
  if (mode === 'plan') return 'em-composer__pill--plan'
  return undefined
}

export function PermissionModePicker({ mode, onChange }: { mode: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [confirmBypass, setConfirmBypass] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const Icon = ICONS[mode] ?? ShieldCheck

  function select(next: PermissionMode) {
    setOpen(false)
    if (next === 'bypassPermissions') {
      setConfirmBypass(true)
      return
    }
    onChange(next)
  }

  return (
    <>
      <button ref={anchorRef} type="button" className={clsx('em-composer__pill', toneClass(mode))} onClick={() => setOpen((o) => !o)}>
        <Icon size={13} strokeWidth={1.75} />
        <span>{t(`shell.composer.mode.${mode}`)}</span>
        <ChevronDown size={11} strokeWidth={1.75} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="top-start" width={220}>
        {MODES.map((m) => {
          const MIcon = ICONS[m]
          return (
            <MenuItem
              key={m}
              icon={<MIcon size={14} strokeWidth={1.75} />}
              label={t(`shell.composer.mode.${m}`)}
              danger={m === 'bypassPermissions'}
              active={m === mode}
              onSelect={() => select(m)}
            />
          )
        })}
      </Popover>
      <ConfirmDialog
        open={confirmBypass}
        title={t('shell.composer.mode.confirmTitle')}
        description={t('shell.composer.mode.confirmBody')}
        confirmLabel={t('shell.composer.mode.confirmOk')}
        onCancel={() => setConfirmBypass(false)}
        onConfirm={() => {
          setConfirmBypass(false)
          onChange('bypassPermissions')
        }}
      />
    </>
  )
}

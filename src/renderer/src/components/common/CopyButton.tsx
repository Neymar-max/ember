import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { IconButton } from './Button'

/** Icon button that copies `text` to the clipboard and briefly shows a check mark. */
export function CopyButton({ text, size = 'sm', className }: { text: string | (() => string); size?: 'sm' | 'md'; className?: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <IconButton
      label={done ? t('common.copied') : t('common.copy')}
      size={size}
      className={className}
      onClick={async (e) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(typeof text === 'function' ? text() : text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
    </IconButton>
  )
}

/** Model picker, right side of the composer toolbar (§4.4). Effort has its own chip (EffortPicker). */
import { ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'
import { MenuItem, Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import type { EffortChoice, ModelOption } from '@shared/types'
import { currentModel, effortStops } from '@/lib/effort'
import './ModelPicker.css'

export function ModelPicker({
  models,
  model,
  cliDefault,
  effort,
  onModelChange,
  onEffortChange,
}: {
  models: ModelOption[]
  model?: string
  /** the CLI's configured default (settings.json `model`), shown when this chat has no explicit choice */
  cliDefault?: string
  effort?: EffortChoice
  onModelChange: (model: string | undefined) => void
  onEffortChange: (effort: EffortChoice | undefined) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const current = currentModel(models, model, cliDefault)
  if (models.length === 0) return null

  return (
    <>
      <button ref={anchorRef} type="button" className="em-composer__pill em-composer__pill--model" onClick={() => setOpen((o) => !o)}>
        <span className="em-modelpick__name">{current?.displayName ?? model ?? t('shell.settings.cli.defaultModel.cli')}</span>
        <ChevronDown size={12} strokeWidth={1.75} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="top-end" width={300}>
        <div className="em-modelpick__list">
          {models.map((m) => (
            <MenuItem
              key={m.value}
              label={m.displayName}
              description={m.description}
              active={m.value === (model || current?.value)}
              onSelect={() => {
                onModelChange(m.value)
                // Keep the chosen effort only if the new model can honour it.
                if (effort && !effortStops(m).includes(effort)) onEffortChange(undefined)
                setOpen(false)
              }}
            />
          ))}
        </div>
      </Popover>
    </>
  )
}

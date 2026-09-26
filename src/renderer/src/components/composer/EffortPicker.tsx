/** Thinking-effort chip next to the model name (Claude-app style). Opens a card with a thick
 * "更快 ↔ 更聪明" slider whose fill colour warms up with the level; Ultracode is the last stop. */
import clsx from 'clsx'
import { CircleHelp } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import { Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import type { EffortChoice, EffortLevel, ModelOption } from '@shared/types'
import { currentModel, effortStops, nearestStop } from '@/lib/effort'
import './EffortPicker.css'

export function EffortPicker({
  models,
  model,
  cliDefault,
  effort,
  effortDefaults,
  defaultEffortLevel,
  onEffortChange,
}: {
  models: ModelOption[]
  model?: string
  cliDefault?: string
  effort?: EffortChoice
  /** settings.json modelSettings[resolvedModel].effortLevel — what the CLI uses when no effort is chosen */
  effortDefaults?: Record<string, EffortLevel>
  defaultEffortLevel?: EffortLevel
  onEffortChange: (effort: EffortChoice | undefined) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const current = currentModel(models, model, cliDefault)
  const stops = effortStops(current)
  if (stops.length === 0) return null

  const cliEffort = (current?.resolvedModel && effortDefaults?.[current.resolvedModel]) || defaultEffortLevel
  // What the session will actually use: the chat's own pick, else the CLI's configured default.
  const effective = nearestStop(stops, effort ?? cliEffort ?? 'high')
  const known = !!effort || !!cliEffort
  const label = (e: EffortChoice) => (e === 'ultracode' ? 'Ultracode' : t(`shell.composer.model.effort.${e}`))
  const idx = stops.indexOf(effective)
  const frac = stops.length > 1 ? idx / (stops.length - 1) : 0

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx('em-effort-chip', open && 'is-open', effective === 'ultracode' && 'is-ultra')}
        title={t('shell.composer.model.effort')}
        onClick={() => setOpen((o) => !o)}
      >
        {known ? label(effective) : t('shell.composer.model.effort.default')}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="top-end" width={300} offset={10} role="dialog">
        <div className="em-effort">
          <div className="em-effort__head">
            <span className="em-effort__title">{t('shell.composer.model.effort')}</span>
            <span className={clsx('em-effort__value', effective === 'ultracode' && 'is-ultra')}>{label(effective)}</span>
            <span className="em-effort__help" title={t('shell.composer.model.effortHelp')}>
              <CircleHelp size={16} strokeWidth={1.6} />
            </span>
          </div>
          <div className="em-effort__ends">
            <span>{t('shell.composer.model.effortFaster')}</span>
            <span>{t('shell.composer.model.effortSmarter')}</span>
          </div>
          <div
            className="em-effort__track"
            data-level={effective}
            style={{ '--frac': frac, '--stops': stops.length } as CSSProperties}
          >
            <div className="em-effort__fill" />
            {stops.map((s, i) =>
              i === idx ? null : (
                <span
                  key={s}
                  className={clsx('em-effort__dot', i < idx && 'is-filled')}
                  style={{ '--pos': stops.length > 1 ? i / (stops.length - 1) : 0 } as CSSProperties}
                />
              ),
            )}
            <input
              type="range"
              className="em-effort__range"
              min={0}
              max={stops.length - 1}
              step={1}
              value={idx}
              aria-label={t('shell.composer.model.effort')}
              aria-valuetext={label(effective)}
              onChange={(e) => onEffortChange(stops[Number(e.target.value)])}
            />
          </div>
          <div className="em-effort__foot">
            {effective === 'ultracode' ? (
              <span>{t('shell.composer.model.ultracodeHint')}</span>
            ) : effort ? (
              <button type="button" className="em-effort__reset" onClick={() => onEffortChange(undefined)}>
                {cliEffort ? t('shell.composer.model.effortResetTo', { level: label(cliEffort) }) : t('shell.composer.model.effortReset')}
              </button>
            ) : (
              <span>{cliEffort ? t('shell.composer.model.effortFromCli') : t('shell.composer.model.effortModelDefault')}</span>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}

/** Effort helpers shared by the model and effort pickers. */
import type { EffortChoice, EffortLevel, ModelOption } from '@shared/types'

export const ALL_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const ORDER: EffortChoice[] = [...ALL_LEVELS, 'ultracode']

/** Stops the slider offers for a model, in order (empty = the model has no effort control). */
export function effortStops(model: ModelOption | undefined): EffortChoice[] {
  if (!model?.supportsEffort) return []
  const supported = model.supportedEffortLevels
  const levels = supported?.length ? ALL_LEVELS.filter((l) => supported.includes(l)) : ALL_LEVELS
  // Ultracode = xhigh + standing workflow orchestration, so it needs an xhigh-capable model.
  return levels.includes('xhigh') ? [...levels, 'ultracode'] : levels
}

export function nearestStop(stops: EffortChoice[], want: EffortChoice): EffortChoice {
  if (stops.includes(want)) return want
  const wi = ORDER.indexOf(want)
  return stops.reduce((best, s) => (Math.abs(ORDER.indexOf(s) - wi) < Math.abs(ORDER.indexOf(best) - wi) ? s : best), stops[0])
}

/** The model option a chat is effectively using: its own pick, else the CLI default, else "Default". */
export function currentModel(models: ModelOption[], model: string | undefined, cliDefault: string | undefined): ModelOption | undefined {
  const id = model || cliDefault
  // settings.json may hold a full id ("claude-opus-5-5") rather than an alias ("opus").
  const match = id ? (models.find((m) => m.value === id) ?? models.find((m) => m.resolvedModel === id)) : undefined
  return match ?? (model ? undefined : models.find((m) => m.value === 'default'))
}

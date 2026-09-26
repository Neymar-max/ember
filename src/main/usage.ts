/**
 * Plan usage (5-hour / weekly windows, plan tier) straight from the CLI's /usage data — no model
 * call. Fetched at startup (probe) and on demand when the usage card opens; live rate_limit_event
 * updates in between come from sessions.ts.
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RateLimitSnapshot, RateLimitWindow } from '@shared/types'
import { getChildEnv } from './env'
import { log } from './log'
import { getCachedCliInfo } from './probe'
import { getAnyLiveQuery, getLatestRateLimits, seedRateLimits } from './sessions'

type Query = ReturnType<typeof query>
type UsageWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined
type UsageResponse = {
  subscription_type?: string | null
  rate_limits_available?: boolean
  rate_limits?: {
    five_hour?: UsageWindow
    seven_day?: UsageWindow
    seven_day_opus?: UsageWindow
    seven_day_sonnet?: UsageWindow
    /** per-model weekly buckets, e.g. {display_name:'Fable', ...} */
    model_scoped?: Array<{ display_name: string; utilization: number | null; resets_at: string | null }>
  } | null
}

const FETCH_TIMEOUT_MS = 8000
const MIN_REFRESH_INTERVAL_MS = 30_000

function toWindow(w: UsageWindow): RateLimitWindow | undefined {
  if (!w || w.utilization == null) return undefined
  const resetsAt = w.resets_at ? Math.floor(Date.parse(w.resets_at) / 1000) : undefined
  // The /usage endpoint always reports percentages (0–100); RateLimitWindow wants 0–1.
  return { utilization: w.utilization / 100, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined }
}

/** "Max (5x)" from subscription_type 'max' + ~/.claude.json oauthAccount.organizationRateLimitTier. */
function planLabel(subscriptionType: string | null | undefined): string | undefined {
  if (!subscriptionType) return undefined
  const name = subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1)
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as {
      oauthAccount?: { organizationRateLimitTier?: string | null; userRateLimitTier?: string | null }
    }
    const tier = cfg.oauthAccount?.userRateLimitTier || cfg.oauthAccount?.organizationRateLimitTier || ''
    const mult = /_(\d+x)$/.exec(tier)?.[1]
    return mult ? `${name} (${mult})` : name
  } catch {
    return name
  }
}

export function parsePlanUsage(u: UsageResponse | null | undefined): RateLimitSnapshot | null {
  if (!u?.rate_limits_available || !u.rate_limits) return null
  const rl = u.rate_limits
  const weeklyByModel: NonNullable<RateLimitSnapshot['weeklyByModel']> = []
  const add = (key: string, label: string, w: UsageWindow) => {
    const window = toWindow(w)
    if (window && !weeklyByModel.some((x) => x.label === label)) weeklyByModel.push({ key, label, window })
  }
  // Server-labelled per-model buckets first (e.g. 'Fable'), then the two fixed legacy windows.
  for (const m of rl.model_scoped ?? []) add(`model:${m.display_name}`, m.display_name, m)
  add('seven_day_opus', 'Opus', rl.seven_day_opus)
  add('seven_day_sonnet', 'Sonnet', rl.seven_day_sonnet)
  const snapshot: RateLimitSnapshot = {
    fiveHour: toWindow(rl.five_hour),
    sevenDay: toWindow(rl.seven_day),
    weeklyByModel,
    planLabel: planLabel(u.subscription_type),
    updatedAt: Date.now(),
  }
  return snapshot.fiveHour || snapshot.sevenDay || weeklyByModel.length ? snapshot : null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('usage request timed out')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Fetch plan usage through an existing query and publish it. Older CLIs lack the request — ignored. */
export async function fetchPlanUsageVia(q: Query): Promise<RateLimitSnapshot | null> {
  try {
    const u = (await withTimeout(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), FETCH_TIMEOUT_MS)) as unknown as UsageResponse
    const snapshot = parsePlanUsage(u)
    if (snapshot) seedRateLimits(snapshot)
    return snapshot
  } catch (e) {
    log.info(`plan usage unavailable: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function* neverYields(): AsyncGenerator<never, void, unknown> {
  await new Promise<never>(() => {})
}

let lastRefresh = 0
let inflight: Promise<RateLimitSnapshot | null> | null = null

/** Refresh plan usage now (throttled): reuse a live session's CLI when one exists, else a short-lived one. */
export function refreshPlanUsage(): Promise<RateLimitSnapshot | null> {
  if (inflight) return inflight
  if (Date.now() - lastRefresh < MIN_REFRESH_INTERVAL_MS) return Promise.resolve(getLatestRateLimits())
  inflight = (async () => {
    try {
      const live = getAnyLiveQuery()
      if (live) return (await fetchPlanUsageVia(live)) ?? getLatestRateLimits()
      const cli = getCachedCliInfo()
      if (!cli.found || !cli.path) return getLatestRateLimits()
      const q = query({
        prompt: neverYields(),
        options: { pathToClaudeCodeExecutable: cli.path, cwd: homedir(), env: await getChildEnv(), persistSession: false },
      })
      try {
        await withTimeout(q.initializationResult(), 15000)
        return (await fetchPlanUsageVia(q)) ?? getLatestRateLimits()
      } finally {
        try {
          q.close()
        } catch {
          // ignore
        }
      }
    } catch (e) {
      log.info(`plan usage refresh failed: ${e instanceof Error ? e.message : String(e)}`)
      return getLatestRateLimits()
    } finally {
      lastRefresh = Date.now()
      inflight = null
    }
  })()
  return inflight
}

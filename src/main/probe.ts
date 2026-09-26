/**
 * Env detection: finds the CLI, runs a message-less SDK session to read
 * account/models/commands (no API usage), and derives EnvStatus.state.
 */
import { query, type AccountInfo, type ModelInfo, type SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountSummary, CliInfo, EffortLevel, EnvStatus, ModelOption, SlashCommandInfo } from '@shared/types'
import { findCli } from './cli'
import { getChildEnv, invalidateShellEnvCache } from './env'
import { log } from './log'
import { getSettings } from './settings'
import { fetchPlanUsageVia } from './usage'

const INIT_TIMEOUT_MS = 15000

let current: EnvStatus = { state: 'checking', cli: { found: false }, models: [], commands: [], checkedAt: Date.now() }
let hasRunOnce = false
let inflight: Promise<EnvStatus> | null = null
let onChange: ((s: EnvStatus) => void) | null = null

export function onEnvChanged(cb: (s: EnvStatus) => void): void {
  onChange = cb
}

export function getCachedCliInfo(): CliInfo {
  return current.cli
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('initializationResult timed out')), ms)
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

function readOauthDisplayName(): string | undefined {
  try {
    const raw = readFileSync(join(homedir(), '.claude.json'), 'utf-8')
    const json = JSON.parse(raw) as { oauthAccount?: { displayName?: string } }
    return json.oauthAccount?.displayName
  } catch {
    return undefined
  }
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** The bits of ~/.claude/settings.json that decide the CLI's default model and effort. */
function readCliDefaults(): { model?: string; modelEffortDefaults?: Record<string, EffortLevel>; defaultEffortLevel?: EffortLevel } {
  try {
    const json = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf-8')) as {
      model?: unknown
      effortLevel?: unknown
      modelSettings?: Record<string, { effortLevel?: unknown } | undefined>
    }
    const modelEffortDefaults: Record<string, EffortLevel> = {}
    for (const [id, cfg] of Object.entries(json.modelSettings ?? {})) {
      if (typeof cfg?.effortLevel === 'string' && EFFORTS.has(cfg.effortLevel)) modelEffortDefaults[id] = cfg.effortLevel as EffortLevel
    }
    return {
      model: typeof json.model === 'string' ? json.model : undefined,
      modelEffortDefaults,
      defaultEffortLevel: typeof json.effortLevel === 'string' && EFFORTS.has(json.effortLevel) ? (json.effortLevel as EffortLevel) : undefined,
    }
  } catch {
    return {}
  }
}

function mapAccount(account: AccountInfo | undefined): AccountSummary | undefined {
  if (!account) return undefined
  return {
    email: account.email,
    organization: account.organization,
    subscriptionType: account.subscriptionType,
    apiProvider: account.apiProvider,
    tokenSource: account.tokenSource,
    apiKeySource: account.apiKeySource,
    displayName: readOauthDisplayName(),
  }
}

function mapModels(models: ModelInfo[]): ModelOption[] {
  return models.map((m) => ({
    value: m.value,
    resolvedModel: m.resolvedModel,
    displayName: m.displayName,
    description: m.description,
    supportsEffort: m.supportsEffort,
    supportedEffortLevels: m.supportedEffortLevels,
  }))
}

function mapCommands(commands: SlashCommand[]): SlashCommandInfo[] {
  return commands.map((c) => ({
    name: c.name,
    description: c.description,
    argumentHint: c.argumentHint,
    aliases: c.aliases,
    builtin: c.builtin,
  }))
}

function determineState(account: AccountSummary | undefined): 'ready' | 'not-logged-in' {
  const noEmail = !account?.email
  const noToken = !account?.tokenSource || account.tokenSource === 'none'
  const noApiKey = !account?.apiKeySource || account.apiKeySource === 'none'
  const firstParty = !account?.apiProvider || account.apiProvider === 'firstParty'
  if (noEmail && noToken && noApiKey && firstParty) return 'not-logged-in'
  return 'ready'
}

async function* neverYields(): AsyncGenerator<never, void, unknown> {
  await new Promise<never>(() => {})
}

async function runProbeInner(): Promise<EnvStatus> {
  const settings = getSettings()
  const childEnv = await getChildEnv()
  const cli = await findCli(settings.cliPath, childEnv)
  if (!cli.found) {
    return { state: 'no-cli', cli, models: [], commands: [], checkedAt: Date.now() }
  }

  let q: ReturnType<typeof query> | undefined
  try {
    q = query({
      prompt: neverYields(),
      options: {
        pathToClaudeCodeExecutable: cli.path,
        cwd: homedir(),
        env: childEnv,
        persistSession: false,
      },
    })
    const init = await withTimeout(q.initializationResult(), INIT_TIMEOUT_MS)
    const account = mapAccount(init.account)
    const cliDefaults = readCliDefaults()
    // Don't hold up the env status on the usage request: fetch it in the background and close the
    // probe process once it settles (see finally).
    const probeQuery = q
    q = undefined
    void fetchPlanUsageVia(probeQuery).finally(() => {
      try {
        probeQuery.close()
      } catch {
        // ignore
      }
    })
    return {
      state: determineState(account),
      cli,
      account,
      models: mapModels(init.models),
      commands: mapCommands(init.commands),
      defaultModel: cliDefaults.model,
      modelEffortDefaults: cliDefaults.modelEffortDefaults,
      defaultEffortLevel: cliDefaults.defaultEffortLevel,
      checkedAt: Date.now(),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error(`probe failed: ${message}`)
    return { state: 'error', cli, models: [], commands: [], error: message, checkedAt: Date.now() }
  } finally {
    try {
      q?.close()
    } catch {
      // ignore
    }
  }
}

/** Cached env status; probes once on first call, otherwise returns the cache (awaiting an in-flight probe). */
export async function getEnvStatus(): Promise<EnvStatus> {
  if (!hasRunOnce) return recheckEnv()
  if (inflight) return inflight
  return current
}

/** Forces a fresh CLI-find + probe cycle. */
export async function recheckEnv(): Promise<EnvStatus> {
  if (inflight) return inflight
  invalidateShellEnvCache()
  inflight = runProbeInner()
    .then((result) => {
      hasRunOnce = true
      const changed = JSON.stringify(result) !== JSON.stringify(current)
      current = result
      if (changed) onChange?.(result)
      return result
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

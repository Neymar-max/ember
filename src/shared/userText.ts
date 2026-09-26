/**
 * The CLI stores a lot of machine-written wrapping inside "user" messages (system reminders,
 * background-task notifications, compact summaries, IDE / vault context, pasted-content wrappers,
 * "[Image #1]" placeholders…). Only the part the person actually typed belongs in the bubble.
 */

export interface CleanUserText {
  /** null = the whole message is machine-generated and should not be shown as a user bubble */
  text: string | null
  /** files the client attached as context (shown as small chips, not as text) */
  attachments: string[]
}

/** Whole-message wrappers that are never something the user typed. */
const MACHINE_ONLY = [
  /^\s*<task-notification>/,
  /^\s*<local-command-caveat>/,
  /^\s*<teammate-message[\s>]/,
  /^\s*<channel-message[\s>]/,
  /^\s*<cross-session-message[\s>]/,
  /^\s*<scheduled-task[\s>]/,
  /^Caveat:/,
  /^This session is being continued from a previous conversation/,
]

const STRIP_BLOCKS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<copilot-context>[\s\S]*?<\/copilot-context>/g,
  /<ide_diagnostics>[\s\S]*?<\/ide_diagnostics>/g,
]

const ATTACH_RE = [
  /<linked_content\s+path="([^"]*)"[^>]*\/>/g,
  /<editor_selection\s+path="([^"]*)"[^>]*>[\s\S]*?<\/editor_selection>/g,
  /<ide_opened_file>[\s\S]*?(?:opened the file|file)\s+(\S+)[\s\S]*?<\/ide_opened_file>/g,
  /<ide_selection>[\s\S]*?from\s+(\S+?):?\s[\s\S]*?<\/ide_selection>/g,
]

export function cleanUserText(raw: string, opts: { isCompactSummary?: boolean } = {}): CleanUserText {
  if (opts.isCompactSummary) return { text: null, attachments: [] }
  let text = raw
  for (const re of STRIP_BLOCKS) text = text.replace(re, '')
  if (MACHINE_ONLY.some((re) => re.test(text.trimStart()))) return { text: null, attachments: [] }

  const attachments: string[] = []
  for (const re of ATTACH_RE) {
    text = text.replace(re, (_m, path: string) => {
      const p = path.replace(/[.,;:]+$/, '')
      if (p && !attachments.includes(p)) attachments.push(p)
      return ''
    })
  }
  // Wrappers whose *content* is the user's words.
  text = text
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, '$1')
    .replace(/<user-message>([\s\S]*?)<\/user-message>/g, '$1')
    .replace(/<user_query>([\s\S]*?)<\/user_query>/g, '$1')
    // Image placeholders — the images themselves are rendered above the text.
    .replace(/\[Image #\d+\]\s?/g, '')
    .replace(/\[Pasted text #\d+[^\]]*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, attachments }
}

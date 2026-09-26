import type { PermissionRequest } from '@shared/types'
import { basename } from '@/lib/format'
import { t } from '@/i18n'

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** "Claude wants to run a command" / "Claude wants to edit foo.ts" / … — CLI-provided
 * `title` always wins when present (SPEC 4.3). */
export function permissionTitle(request: PermissionRequest): string {
  if (request.title) return request.title
  const input = request.input ?? {}
  switch (request.toolName) {
    case 'Bash':
      return t('tools.perm.titleBash')
    case 'Edit':
    case 'MultiEdit':
      return t('tools.perm.titleEdit', { name: basename(str(input.file_path)) })
    case 'Write':
      return t('tools.perm.titleWrite', { name: basename(str(input.file_path)) })
    case 'Read':
      return t('tools.perm.titleRead', { name: basename(str(input.file_path)) })
    case 'NotebookEdit':
      return t('tools.perm.titleNotebook', { name: basename(str(input.notebook_path)) })
    default:
      return t('tools.perm.titleGeneric', { name: request.displayName || request.toolName })
  }
}

/** Tooltip for the "always allow" button — the actual rule is opaque (CLI-provided
 * PermissionUpdate objects), so this is a best-effort description of its likely effect. */
export function alwaysAllowHint(toolName: string): string {
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return t('tools.perm.alwaysAllowEdits')
  }
  return t('tools.perm.alwaysAllowGeneric')
}

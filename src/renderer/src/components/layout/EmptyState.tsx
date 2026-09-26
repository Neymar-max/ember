/** New-chat welcome screen: greeting, centered composer, project picker, suggestion chips (§4.1). */
import { EmberMark } from '@/components/common/Spinner'
import { Composer } from '@/components/composer/Composer'
import { useT } from '@/i18n'
import { useApp } from '@/store/app'
import { useChat, useChats } from '@/store/chats'
import { ProjectPicker } from './ProjectPicker'
import './EmptyState.css'

function greetingKey(hour: number): string {
  if (hour >= 6 && hour < 12) return 'shell.greeting.morning'
  if (hour >= 12 && hour < 18) return 'shell.greeting.afternoon'
  return 'shell.greeting.evening'
}

const SUGGESTIONS = ['shell.suggestion.explore', 'shell.suggestion.bug', 'shell.suggestion.tests', 'shell.suggestion.review']

export function EmptyState({ chatId }: { chatId: string | null }) {
  const t = useT()
  const env = useApp((s) => s.env)
  const appInfo = useApp((s) => s.appInfo)
  const settings = useApp((s) => s.settings)
  const chat = useChat(chatId)

  const displayName = env?.account?.displayName || env?.account?.email?.split('@')[0] || appInfo?.userName || ''
  const cwd = chat?.cwd || settings.lastProject || appInfo?.homeDir || ''

  function pickProject(dir: string) {
    if (chatId && chat?.status === 'new') useChats.getState().setCwd(chatId, dir)
    else useChats.getState().newChat(dir)
  }

  function fillSuggestion(text: string) {
    document.dispatchEvent(new CustomEvent('ember:fill-composer', { detail: text }))
  }

  return (
    <div className="em-shell-empty">
      <div className="em-shell-empty__greeting">
        <div className="em-shell-empty__title">
          <EmberMark size={30} />
          {t(greetingKey(new Date().getHours()), { name: displayName })}
        </div>
        <div className="em-shell-empty__sub">{t('shell.greeting.sub')}</div>
      </div>

      <div className="em-shell-empty__composer">
        <Composer chatId={chatId ?? ''} variant="centered" />
      </div>

      <div className="em-shell-empty__project">
        <ProjectPicker cwd={cwd} onPick={pickProject} />
      </div>

      <div className="em-shell-empty__suggestions">
        {SUGGESTIONS.map((key) => (
          <button key={key} type="button" className="em-shell-empty__chip" onClick={() => fillSuggestion(t(key))}>
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}

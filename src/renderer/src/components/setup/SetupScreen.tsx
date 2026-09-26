/** Full-screen gate shown until the CLI is found and logged in (§4.7). No login form is ever rendered here. */
import { AlertTriangle, Copy, SearchX, UserX } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { EmberSpark } from '@/components/common/Spinner'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { useApp } from '@/store/app'
import type { EnvStatus } from '@shared/types'
import './SetupScreen.css'

const CURL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash'
const NPM_CMD = 'npm install -g @anthropic-ai/claude-code'

function CopyCommand({ command }: { command: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="em-setup-card__cmd">
      <code>{command}</code>
      <Button
        variant="ghost"
        size="sm"
        icon={<Copy size={13} strokeWidth={1.75} />}
        onClick={async () => {
          await navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  )
}

async function pickCliPath() {
  const path = await ember.sys.pickExecutable()
  if (!path) return
  await useApp.getState().updateSettings({ cliPath: path })
  void useApp.getState().recheckEnv()
}

export function SetupScreen({ env }: { env: EnvStatus | null }) {
  const t = useT()
  const appInfo = useApp((s) => s.appInfo)
  const state = env?.state ?? 'checking'

  if (state === 'checking') {
    return (
      <div className="em-setup">
        <div className="em-setup__checking">
          <EmberSpark size={40} />
          <div className="em-setup__checking-text">{t('shell.setup.checking')}</div>
        </div>
      </div>
    )
  }

  if (state === 'no-cli') {
    return (
      <div className="em-setup">
        <div className="em-setup-card">
          <div className="em-setup-card__icon em-setup-card__icon--warning">
            <SearchX size={22} strokeWidth={1.75} />
          </div>
          <div className="em-setup-card__title">{t('shell.setup.noCli.title')}</div>
          <div className="em-setup-card__body">{t('shell.setup.noCli.body')}</div>
          <div className="em-setup-card__cmd-label">{t('shell.setup.noCli.curl')}</div>
          <CopyCommand command={CURL_CMD} />
          <div className="em-setup-card__cmd-label">{t('shell.setup.noCli.npm')}</div>
          <CopyCommand command={NPM_CMD} />
          <div className="em-setup-card__actions">
            <Button variant="primary" onClick={() => void useApp.getState().recheckEnv()}>
              {t('shell.setup.recheck')}
            </Button>
            <Button variant="secondary" onClick={() => void pickCliPath()}>
              {t('shell.setup.pickPath')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (state === 'not-logged-in') {
    return (
      <div className="em-setup">
        <div className="em-setup-card">
          <div className="em-setup-card__icon em-setup-card__icon--warning">
            <UserX size={22} strokeWidth={1.75} />
          </div>
          <div className="em-setup-card__title">{t('shell.setup.notLoggedIn.title')}</div>
          <div className="em-setup-card__body">{t('shell.setup.notLoggedIn.body')}</div>
          <ol className="em-setup-card__steps">
            {[
              { pre: t('shell.setup.notLoggedIn.step1') },
              { pre: t('shell.setup.notLoggedIn.step2'), code: 'claude' },
              { pre: t('shell.setup.notLoggedIn.step3'), code: '/login', post: t('shell.setup.notLoggedIn.step3suffix') },
              { pre: t('shell.setup.notLoggedIn.step4') },
            ].map((step, i) => (
              <li key={i}>
                <span className="em-setup-card__step-num">{i + 1}</span>
                <span>
                  {step.pre}
                  {step.code && <code>{step.code}</code>}
                  {step.post}
                </span>
              </li>
            ))}
          </ol>
          <div className="em-setup-card__actions">
            <Button variant="primary" onClick={() => void ember.sys.openInTerminal(appInfo?.homeDir ?? '~', 'claude')}>
              {t('shell.setup.openTerminal')}
            </Button>
            <Button variant="secondary" onClick={() => void useApp.getState().recheckEnv()}>
              {t('shell.setup.recheck')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // state === 'error'
  return (
    <div className="em-setup">
      <div className="em-setup-card">
        <div className="em-setup-card__icon em-setup-card__icon--danger">
          <AlertTriangle size={22} strokeWidth={1.75} />
        </div>
        <div className="em-setup-card__title">{t('shell.setup.error.title')}</div>
        {env?.error && (
          <details className="em-setup-card__detail">
            <summary>{t('shell.setup.error.detail')}</summary>
            <pre>{env.error}</pre>
          </details>
        )}
        <div className="em-setup-card__actions">
          <Button variant="primary" onClick={() => void useApp.getState().recheckEnv()}>
            {t('shell.setup.recheck')}
          </Button>
          <Button variant="secondary" onClick={() => void pickCliPath()}>
            {t('shell.setup.pickPath')}
          </Button>
        </div>
      </div>
    </div>
  )
}

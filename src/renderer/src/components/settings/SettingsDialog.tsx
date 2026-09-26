/** Preferences modal: Appearance / General / Claude Code / About (§4.6). */
import { Info, Monitor, Moon, Settings as SettingsIcon, Sparkles, Sun } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { Dialog, DialogHeader } from '@/components/common/Dialog'
import { EmberMark } from '@/components/common/Spinner'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { useApp } from '@/store/app'
import type { AppSettings, EffortChoice, LanguageSetting, MessageFont, PermissionMode, ThemeSetting } from '@shared/types'
import './SettingsDialog.css'

type Tab = 'appearance' | 'general' | 'claude' | 'about'

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`em-switch${on ? ' is-on' : ''}`} onClick={onToggle}>
      <span className="em-switch__knob" />
    </button>
  )
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="em-settings__row-toggle">
      <span>{label}</span>
      <Switch on={on} onToggle={onToggle} />
    </div>
  )
}

const THEME_CARDS: { value: ThemeSetting; Icon: typeof Sun }[] = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
]
const FONT_CARDS: MessageFont[] = ['claude', 'mixed', 'sans']
const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']
const EFFORT_LEVELS: EffortChoice[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const env = useApp((s) => s.env)
  const appInfo = useApp((s) => s.appInfo)
  const [tab, setTab] = useState<Tab>('appearance')

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    void useApp.getState().updateSettings({ [key]: value } as Partial<AppSettings>)
  }

  const NAV: { key: Tab; label: string; Icon: typeof SettingsIcon }[] = [
    { key: 'appearance', label: t('shell.settings.nav.appearance'), Icon: Sun },
    { key: 'general', label: t('shell.settings.nav.general'), Icon: SettingsIcon },
    { key: 'claude', label: t('shell.settings.nav.claudeCode'), Icon: Sparkles },
    { key: 'about', label: t('shell.settings.nav.about'), Icon: Info },
  ]

  return (
    <Dialog open={open} onClose={onClose} width={640} labelledBy="em-settings-title">
      <div className="em-settings">
        <nav className="em-settings__nav">
          {NAV.map(({ key, label, Icon }) => (
            <button key={key} type="button" className={`em-settings__nav-item${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>
              <Icon size={15} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </nav>
        <div className="em-settings__content">
          <DialogHeader id="em-settings-title">
            <span className="em-settings__title">{t('shell.settings.title')}</span>
          </DialogHeader>
          <div className="em-settings__body">
            {tab === 'appearance' && (
              <>
                <div className="em-settings__field">
                  <div className="em-settings__label">{t('shell.settings.appearance.theme')}</div>
                  <div className="em-settings__cards">
                    {THEME_CARDS.map(({ value, Icon }) => (
                      <button key={value} type="button" className={`em-settings__card${settings.theme === value ? ' is-active' : ''}`} onClick={() => set('theme', value)}>
                        <Icon size={18} strokeWidth={1.75} />
                        <span>{t(`shell.settings.appearance.theme.${value}`)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__label">{t('shell.settings.appearance.font')}</div>
                  <div className="em-settings__cards">
                    {FONT_CARDS.map((value) => (
                      <button key={value} type="button" className={`em-settings__card${settings.messageFont === value ? ' is-active' : ''}`} onClick={() => set('messageFont', value)}>
                        <span style={{ fontSize: 16 }}>Aa</span>
                        <span>{t(`shell.settings.appearance.font.${value}`)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="em-settings__fontpreview">{t('shell.settings.appearance.fontPreview')}</div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.appearance.fontSize')}</div>
                    <span className="em-settings__hint">{settings.fontSize}px</span>
                  </div>
                  <input
                    className="em-settings__slider"
                    type="range"
                    min={14}
                    max={20}
                    step={1}
                    value={settings.fontSize}
                    onChange={(e) => set('fontSize', Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {tab === 'general' && (
              <>
                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.general.language')}</div>
                    <select className="em-settings__select" value={settings.language} onChange={(e) => set('language', e.target.value as LanguageSetting)}>
                      <option value="system">{t('shell.settings.general.language.system')}</option>
                      <option value="zh">{t('shell.settings.general.language.zh')}</option>
                      <option value="en">{t('shell.settings.general.language.en')}</option>
                    </select>
                  </div>
                </div>
                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.general.sendKey')}</div>
                    <select className="em-settings__select" value={settings.sendKey} onChange={(e) => set('sendKey', e.target.value as AppSettings['sendKey'])}>
                      <option value="enter">{t('shell.settings.general.sendKey.enter')}</option>
                      <option value="cmdEnter">{t('shell.settings.general.sendKey.cmdEnter')}</option>
                    </select>
                  </div>
                </div>
                <div className="em-settings__field">
                  <ToggleRow label={t('shell.settings.general.notifyOnDone')} on={settings.notifyOnDone} onToggle={() => set('notifyOnDone', !settings.notifyOnDone)} />
                  <ToggleRow label={t('shell.settings.general.showThinking')} on={settings.showThinking} onToggle={() => set('showThinking', !settings.showThinking)} />
                  <ToggleRow label={t('shell.settings.general.showCost')} on={settings.showCost} onToggle={() => set('showCost', !settings.showCost)} />
                </div>
              </>
            )}

            {tab === 'claude' && (
              <>
                <div className="em-settings__field">
                  <div className="em-settings__label">{t('shell.settings.cli.path')}</div>
                  <div className="em-settings__cli-row">
                    <span className="em-settings__cli-path">
                      {env?.cli.found ? `${env.cli.path} ${env.cli.version ? `· ${env.cli.version}` : ''}` : t('shell.settings.cli.notFound')}
                    </span>
                  </div>
                  <div className="em-settings__cli-row">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void ember.sys.pickExecutable().then((p) => {
                          if (p) set('cliPath', p)
                        })
                      }
                    >
                      {t('shell.settings.cli.change')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => set('cliPath', '')}>
                      {t('shell.settings.cli.pathAuto')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void useApp.getState().recheckEnv()}>
                      {t('shell.settings.cli.recheck')}
                    </Button>
                  </div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__label">{t('shell.settings.cli.account')}</div>
                  <div className="em-settings__hint">
                    {env?.account?.email
                      ? [env.account.email, env.account.organization, env.account.subscriptionType].filter(Boolean).join(' · ')
                      : t('shell.settings.cli.account.none')}
                  </div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.cli.defaultModel')}</div>
                    <select className="em-settings__select" value={settings.defaultModel} onChange={(e) => set('defaultModel', e.target.value)}>
                      <option value="">{t('shell.settings.cli.defaultModel.cli')}</option>
                      {(env?.models ?? []).map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.cli.defaultMode')}</div>
                    <select
                      className="em-settings__select"
                      value={settings.defaultPermissionMode}
                      onChange={(e) => set('defaultPermissionMode', e.target.value as PermissionMode)}
                    >
                      {PERMISSION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(`shell.composer.mode.${m}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="em-settings__field">
                  <div className="em-settings__field-row">
                    <div className="em-settings__label">{t('shell.settings.cli.defaultEffort')}</div>
                    <select
                      className="em-settings__select"
                      value={settings.defaultEffort}
                      onChange={(e) => set('defaultEffort', e.target.value as EffortChoice | '')}
                    >
                      <option value="">{t('shell.settings.cli.defaultEffort.model')}</option>
                      {EFFORT_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {t(`shell.composer.model.effort.${lvl}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="em-settings__hint">{t('shell.settings.cli.note')}</div>
              </>
            )}

            {tab === 'about' && (
              <div className="em-settings__about">
                <EmberMark size={36} />
                <div className="em-settings__about-title">Ember</div>
                <div className="em-settings__hint">{t('shell.settings.about.version', { version: appInfo?.version ?? '—' })}</div>
                <div className="em-settings__hint">{t('shell.settings.about.tagline')}</div>
                {appInfo?.homeDir && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void ember.sys.showInFinder(`${appInfo.homeDir}/Library/Logs/Ember/main.log`)}
                  >
                    {t('shell.settings.about.showLog')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

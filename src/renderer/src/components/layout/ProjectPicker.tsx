/** Folder chip + dropdown: recent projects, or pick a new one (§4.1). Used by the new-chat empty state. */
import clsx from 'clsx'
import { ChevronDown, Folder, FolderOpen } from 'lucide-react'
import { useRef, useState } from 'react'
import { MenuHeading, MenuItem, MenuSeparator, Popover } from '@/components/common/Popover'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { basename, dirname, tildify } from '@/lib/format'
import { useApp } from '@/store/app'
import './ProjectPicker.css'

export function ProjectPicker({ cwd, onPick, className }: { cwd: string; onPick: (dir: string) => void; className?: string }) {
  const t = useT()
  const recentProjects = useApp((s) => s.settings.recentProjects)
  const homeDir = useApp((s) => s.appInfo?.homeDir)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const name = cwd ? basename(cwd) : t('shell.composer.project.pick')

  async function chooseFolder() {
    const dir = await ember.sys.pickDirectory(cwd || undefined)
    setOpen(false)
    if (!dir) return
    await useApp.getState().touchProject(dir)
    onPick(dir)
  }

  return (
    <>
      <button ref={anchorRef} type="button" className={clsx('em-shell-projectpicker', className)} onClick={() => setOpen((o) => !o)} title={cwd}>
        <Folder size={13} strokeWidth={1.75} />
        <span className="em-shell-projectpicker__name">{name}</span>
        <ChevronDown size={13} strokeWidth={1.75} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-start" width={300}>
        {recentProjects.length > 0 && (
          <>
            <MenuHeading>{t('shell.sidebar.recentProjects')}</MenuHeading>
            {recentProjects.map((dir) => (
              <MenuItem
                key={dir}
                icon={<Folder size={14} strokeWidth={1.75} />}
                label={basename(dir)}
                description={tildify(dirname(dir), homeDir)}
                active={dir === cwd}
                onSelect={() => {
                  onPick(dir)
                  setOpen(false)
                }}
              />
            ))}
            <MenuSeparator />
          </>
        )}
        <MenuItem icon={<FolderOpen size={14} strokeWidth={1.75} />} label={t('shell.sidebar.chooseFolder')} onSelect={() => void chooseFolder()} />
      </Popover>
    </>
  )
}

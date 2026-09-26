/** Read-only preview of one file in the side panel: Markdown rendered, code highlighted. */
import { ArrowLeft, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { Markdown } from '@/components/chat/Markdown'
import { Spinner } from '@/components/common/Spinner'
import { useT } from '@/i18n'
import { ember } from '@/lib/api'
import { basename, displayPath } from '@/lib/format'
import { usePanel } from '@/store/panel'
import type { FilePreview } from '@shared/types'

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', py: 'python', sh: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', css: 'css', html: 'html', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', swift: 'swift', rb: 'ruby', sql: 'sql', xml: 'xml', kt: 'kotlin', lua: 'lua', r: 'r',
}
const HIGHLIGHT_MAX = 200 * 1024

export function FilePreviewPane({ path, cwd }: { path: string; cwd?: string }) {
  const t = useT()
  const closeFile = usePanel((s) => s.closeFile)
  const [file, setFile] = useState<FilePreview | null>(null)

  const load = useCallback(() => {
    setFile(null)
    void ember.files.read(path, cwd).then(setFile)
  }, [path, cwd])
  useEffect(load, [load])

  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  const shown = file ? displayPath(file.path, cwd) : path

  let body: React.ReactNode
  if (!file) body = <div className="em-panel-empty"><Spinner size={16} /></div>
  else if (!file.exists || file.error) body = <div className="em-panel-empty"><b>{t('shell.panel.notFound')}</b><span>{t('shell.panel.notFoundHint')}</span></div>
  else if (file.isDirectory) body = <div className="em-panel-empty">{t('shell.panel.isFolder')}</div>
  else if (file.binary) body = <div className="em-panel-empty">{t('shell.panel.binary')}</div>
  else if (ext === 'md' || ext === 'markdown') body = <div className="em-panel-preview__md"><Markdown text={file.content ?? ''} variant="message" /></div>
  else if ((file.content?.length ?? 0) > HIGHLIGHT_MAX) body = <pre className="em-panel-preview__plain">{file.content}</pre>
  else body = <CodeBlock code={file.content ?? ''} language={LANG[ext] ?? (ext || 'text')} startLine={1} bare />

  return (
    <div className="em-panel-preview">
      <div className="em-panel-preview__bar">
        <button type="button" className="em-panel-iconbtn" title={t('shell.panel.back')} aria-label={t('shell.panel.back')} onClick={closeFile}>
          <ArrowLeft size={15} strokeWidth={1.75} />
        </button>
        <div className="em-panel-preview__name" title={file?.path ?? path}>
          <span>{basename(shown)}</span>
          <span className="em-panel-preview__dir">{shown}</span>
        </div>
        <button type="button" className="em-panel-iconbtn" title={t('shell.panel.reload')} aria-label={t('shell.panel.reload')} onClick={load}>
          <RefreshCw size={14} strokeWidth={1.75} />
        </button>
        {file?.exists && (
          <>
            <button type="button" className="em-panel-iconbtn" title={t('shell.panel.showInFinder')} aria-label={t('shell.panel.showInFinder')} onClick={() => void ember.sys.showInFinder(file.path)}>
              <FolderOpen size={14} strokeWidth={1.75} />
            </button>
            <button type="button" className="em-panel-iconbtn" title={t('shell.panel.openDefault')} aria-label={t('shell.panel.openDefault')} onClick={() => void ember.sys.openPath(file.path)}>
              <ExternalLink size={14} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>
      {file?.truncated && <div className="em-panel-hint em-panel-preview__trunc">{t('shell.panel.truncated')}</div>}
      <div className="em-panel-preview__body">{body}</div>
    </div>
  )
}

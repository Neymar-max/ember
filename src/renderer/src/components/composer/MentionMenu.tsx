/** "@" file mention autocomplete popover (§4.4). Purely presentational. */
import { File, Folder } from 'lucide-react'
import type { RefObject } from 'react'
import { MenuItem, Popover } from '@/components/common/Popover'
import type { FileSuggestion } from '@shared/types'

export function MentionMenu({
  open,
  anchorRef,
  items,
  activeIndex,
  onHover,
  onSelect,
  onClose,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  items: FileSuggestion[]
  activeIndex: number
  onHover: (i: number) => void
  onSelect: (item: FileSuggestion) => void
  onClose: () => void
}) {
  return (
    <Popover open={open && items.length > 0} onClose={onClose} anchorRef={anchorRef} placement="top-start" matchAnchorWidth>
      {items.map((item, i) => (
        <div key={item.path} onMouseEnter={() => onHover(i)}>
          <MenuItem
            active={i === activeIndex}
            icon={item.isDir ? <Folder size={14} strokeWidth={1.75} /> : <File size={14} strokeWidth={1.75} />}
            label={<span className="em-mono">{item.path}</span>}
            onSelect={() => onSelect(item)}
          />
        </div>
      ))}
    </Popover>
  )
}

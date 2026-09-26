/** "/" command autocomplete popover (§4.4). Purely presentational — Composer owns filtering + keyboard nav. */
import { MenuItem, Popover } from '@/components/common/Popover'
import type { SlashCommandInfo } from '@shared/types'
import type { RefObject } from 'react'

export function SlashMenu({
  open,
  anchorRef,
  commands,
  activeIndex,
  onHover,
  onSelect,
  onClose,
}: {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  commands: SlashCommandInfo[]
  activeIndex: number
  onHover: (i: number) => void
  onSelect: (cmd: SlashCommandInfo) => void
  onClose: () => void
}) {
  return (
    <Popover open={open && commands.length > 0} onClose={onClose} anchorRef={anchorRef} placement="top-start" matchAnchorWidth>
      {commands.map((cmd, i) => (
        <div key={cmd.name} onMouseEnter={() => onHover(i)}>
          <MenuItem
            active={i === activeIndex}
            icon={<span className="em-mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>/</span>}
            label={<span className="em-mono">{cmd.name}</span>}
            description={cmd.description}
            hint={cmd.argumentHint}
            onSelect={() => onSelect(cmd)}
          />
        </div>
      ))}
    </Popover>
  )
}

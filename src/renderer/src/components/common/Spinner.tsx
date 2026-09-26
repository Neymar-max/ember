import clsx from 'clsx'
import './common.css'

/** Small circular spinner (currentColor). */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx('em-ui-spinner', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 16 16" width={size} height={size}>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
        <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/** Ember's signature "working" glyph: a softly pulsing terracotta spark (our own mark, not Anthropic's logo). */
export function EmberSpark({ size = 18, animated = true, className }: { size?: number; animated?: boolean; className?: string }) {
  return (
    <span className={clsx('em-ui-spark', animated && 'is-animated', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <circle cx="12" cy="12" r="5.2" fill="var(--accent-brand)" />
        <g stroke="var(--accent-brand)" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2M4.8 4.8l2.2 2.2M17 17l2.2 2.2M4.8 19.2 7 17M17 7l2.2-2.2" />
        </g>
      </svg>
    </span>
  )
}

/** Ember's brand mark (same motif as the app icon): a glowing coal with a terminal prompt. */
export function EmberMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx('em-ui-mark', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <defs>
          <radialGradient id="em-mark-coal" cx="0.38" cy="0.32" r="0.8">
            <stop offset="0" stopColor="#ec9a74" />
            <stop offset="0.55" stopColor="#d97757" />
            <stop offset="1" stopColor="#b9532f" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#em-mark-coal)" />
        <path d="M8.2 8.2 12 12l-3.8 3.8" fill="none" stroke="#fbf6ec" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="13" y="14.6" width="4.6" height="2.1" rx="1.05" fill="#fbf6ec" />
      </svg>
    </span>
  )
}

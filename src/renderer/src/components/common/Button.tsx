import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './common.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

/** Text button. primary = terracotta fill; secondary = surface + border; ghost = transparent. */
export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={clsx('em-ui-btn', `em-ui-btn--${variant}`, `em-ui-btn--${size}`, className)} {...rest}>
      {icon}
      {children != null && <span>{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** accessible label + native tooltip */
  label: string
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
}

/** Square, borderless icon button with hover background. Pass a lucide icon as child. */
export function IconButton({ label, size = 'md', active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx('em-ui-iconbtn', `em-ui-iconbtn--${size}`, active && 'is-active', className)}
      {...rest}
    >
      {children}
    </button>
  )
}

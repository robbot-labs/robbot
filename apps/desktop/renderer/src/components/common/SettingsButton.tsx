import type { ButtonHTMLAttributes, ReactNode } from 'react'

type SettingsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  iconOnly?: boolean
}

export function SettingsButton({ children, className = '', iconOnly = false, type = 'button', ...props }: SettingsButtonProps) {
  const baseClassName = iconOnly
    ? 'absolute inset-y-0 right-0 inline-flex cursor-pointer items-center bg-transparent px-3 text-slate-400 transition-colors hover:bg-transparent hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50'
    : 'group inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-indigo-50 px-2 text-[12px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <button type={type} className={`${baseClassName} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}

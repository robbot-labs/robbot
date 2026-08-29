import { LogOut } from 'lucide-react'

type AccountSettingsPanelProps = {
  email: string
  onLogout(): void
}

export function AccountSettingsPanel(props: AccountSettingsPanelProps) {
  return (
    <div className="flex h-full flex-col p-6">
      <h3 className="m-0 text-base font-semibold text-slate-950">Account</h3>
      <p className="mt-1 text-sm text-slate-500">Your Robbot account</p>

      <div className="mt-6">
        <label className="text-xs font-medium text-slate-600">Email</label>
        <div className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {props.email || '—'}
        </div>
      </div>

      <button
        className="mt-auto flex w-fit items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
        onClick={props.onLogout}
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )
}

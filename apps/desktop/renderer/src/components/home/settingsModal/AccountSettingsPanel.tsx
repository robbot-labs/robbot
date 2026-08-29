import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsButton } from '../../common/SettingsButton'

type AccountSettingsPanelProps = {
  email: string
  onLogout(): void
}

export function AccountSettingsPanel(props: AccountSettingsPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col p-6">
      <h3 className="m-0 text-base font-semibold text-slate-950">{t('settings.account.title')}</h3>
      <p className="mt-1 text-sm text-slate-500">{t('settings.account.description')}</p>

      <div className="mt-6">
        <label className="text-xs font-medium text-slate-600">{t('settings.account.email')}</label>
        <div className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {props.email || '—'}
        </div>
      </div>

      <SettingsButton
        className="mt-6 w-fit"
        onClick={props.onLogout}
      >
        <LogOut className="h-3.5 w-3.5" />
        {t('settings.account.signOut')}
      </SettingsButton>
    </div>
  )
}

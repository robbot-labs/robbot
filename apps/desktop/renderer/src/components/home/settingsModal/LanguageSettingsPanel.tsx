import { FormControl, MenuItem, OutlinedInput, Select } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { type AppLanguage, LANGUAGE_STORAGE_KEY } from '../../../i18n'

export function LanguageSettingsPanel() {
  const { t, i18n } = useTranslation()
  const language: AppLanguage = i18n.resolvedLanguage === 'en' ? 'en' : 'zh'

  const handleLanguageChange = async (next: AppLanguage) => {
    await i18n.changeLanguage(next)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next)
  }

  return (
    <div className="p-6">
      <h3 className="m-0 text-base font-semibold text-slate-950">{t('settings.language.title')}</h3>
      <p className="mt-1 text-sm text-slate-500">{t('settings.language.description')}</p>

      <div className="mt-6 max-w-sm">
        <FormControl fullWidth size="small">
          <Select
            value={language}
            onChange={(event) => void handleLanguageChange(event.target.value as AppLanguage)}
            input={<OutlinedInput />}
          >
            <MenuItem value="zh">{t('settings.language.chinese')}</MenuItem>
            <MenuItem value="en">{t('settings.language.english')}</MenuItem>
          </Select>
        </FormControl>
      </div>
    </div>
  )
}

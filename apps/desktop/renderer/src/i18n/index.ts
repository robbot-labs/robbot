import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './messages/en.json'
import zh from './messages/zh.json'

export type AppLanguage = 'zh' | 'en'

export const APP_LANGUAGES: AppLanguage[] = ['zh', 'en']
export const LANGUAGE_STORAGE_KEY = 'robbot.language'

const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)

const defaultLanguage: AppLanguage =
  savedLanguage === 'zh' || savedLanguage === 'en'
    ? savedLanguage
    : navigator.language.toLowerCase().startsWith('zh')
      ? 'zh'
      : 'en'

void i18n
  .use(initReactI18next)
  .init({
    lng: defaultLanguage,
    fallbackLng: 'zh',
    resources: {
      zh: {
        translation: zh,
      },
      en: {
        translation: en,
      },
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n

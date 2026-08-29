import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UpdateCheckState } from '../../../hooks/useDesktopUpdateCheck'
import { get36KrAiInformation, getAibaseNews, getWeiboHot } from '../../../services/api'
import { SettingsButton } from '../../common/SettingsButton'

type RsshubTestSource = 'weiboHot' | 'aibaseNews' | 'kr36AiInformation'

type VersionSettingsPanelProps = {
  appVersion: string
  updateCheck: UpdateCheckState
  onCheckUpdate(options?: { force?: boolean }): Promise<unknown>
}

const rsshubTestSources: Array<{
  id: RsshubTestSource
  labelKey: string
  path: string
  request: () => ReturnType<typeof getWeiboHot>
}> = [
  {
    id: 'weiboHot',
    labelKey: 'settings.version.sources.weiboHot',
    path: '/api/robbot/weibo/hot',
    request: () => getWeiboHot({ refresh: false }),
  },
  {
    id: 'aibaseNews',
    labelKey: 'settings.version.sources.aibaseNews',
    path: '/api/robbot/aibase/news',
    request: () => getAibaseNews({ refresh: false }),
  },
  {
    id: 'kr36AiInformation',
    labelKey: 'settings.version.sources.kr36AiInformation',
    path: '/api/robbot/36kr/information/AI',
    request: () => get36KrAiInformation({ refresh: false }),
  },
]

export function VersionSettingsPanel(props: VersionSettingsPanelProps) {
  const { t } = useTranslation()
  const [testingRsshubSource, setTestingRsshubSource] = useState<RsshubTestSource | null>(null)

  const checkUpdate = async () => {
    await props.onCheckUpdate({ force: true })
  }

  const testRsshubSource = async (source: (typeof rsshubTestSources)[number]) => {
    setTestingRsshubSource(source.id)

    try {
      const result = await source.request()
      const label = t(source.labelKey)
      if (result.code !== 1 || !result.data) {
        toast.error(t('settings.version.requestFailed', { label, message: result.msg || 'Request failed' }))
        return
      }

      const staleText = result.data.stale ? t('settings.version.staleCache') : ''
      toast.success(t('settings.version.requestSuccess', { label, count: result.data.items.length, stale: staleText }), { duration: 1000 })
    } finally {
      setTestingRsshubSource(null)
    }
  }

  const openUpdateDownload = async () => {
    const url = props.updateCheck.result?.downloadUrl
    if (!url) return
    try {
      await window.robbot.app.openExternal(url)
    } catch (cause) {
      toast.error(t('settings.version.downloadOpenFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  return (
    <div className="p-6">
      <h3 className="m-0 text-base font-semibold text-slate-950">{t('settings.version.title')}</h3>
      <p className="mt-1 text-sm text-slate-500">{t('settings.version.description')}</p>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">{t('settings.version.desktopUpdate')}</div>
            <div className="mt-1 text-xs text-slate-500">
              {t('settings.version.currentVersion', {
                version: props.appVersion || '—',
                platform: window.robbot.app.platform,
                arch: window.robbot.app.arch,
              })}
            </div>
          </div>
          <SettingsButton
            disabled={props.updateCheck.status === 'checking'}
            onClick={() => void checkUpdate()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${props.updateCheck.status === 'checking' ? 'animate-spin' : ''}`} />
            {props.updateCheck.status === 'checking' ? t('settings.version.checking') : t('settings.version.checkUpdate')}
          </SettingsButton>
        </div>

        {props.updateCheck.status === 'latest' ? (
          <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {t('settings.version.latest')}
          </div>
        ) : null}

        {props.updateCheck.status === 'failed' ? (
          <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {props.updateCheck.message}
          </div>
        ) : null}

        {props.updateCheck.status === 'available' ? (
          <div className="mt-3 rounded-md bg-amber-50 px-3 py-3 text-xs text-amber-800">
            <div className="font-medium">
              {t('settings.version.available', { version: props.updateCheck.result.latestVersion })}
              {props.updateCheck.result.forceUpdate ? ` - ${t('settings.version.required')}` : ''}
            </div>
            {props.updateCheck.result.releaseNotes ? (
              <div className="mt-1 whitespace-pre-wrap text-amber-700">{props.updateCheck.result.releaseNotes}</div>
            ) : null}
            {props.updateCheck.result.downloadUrl ? (
              <SettingsButton
                className="mt-3"
                onClick={() => void openUpdateDownload()}
              >
                <Download className="h-3.5 w-3.5" />
                {t('settings.version.downloadInstaller')}
              </SettingsButton>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div>
            <div className="text-sm font-medium text-slate-900">{t('settings.version.rsshubTest')}</div>
            <div className="mt-1 text-xs text-slate-500">{t('settings.version.rsshubDescription')}</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {rsshubTestSources.map((source) => {
              const testing = testingRsshubSource === source.id

              return (
                <SettingsButton
                  key={source.id}
                  title={t('settings.version.requestPath', { path: source.path })}
                  disabled={testingRsshubSource !== null}
                  onClick={() => void testRsshubSource(source)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? t('settings.version.testing') : t(source.labelKey)}
                </SettingsButton>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

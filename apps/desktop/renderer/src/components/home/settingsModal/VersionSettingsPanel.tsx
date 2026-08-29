import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateCheckState } from '../../../hooks/useDesktopUpdateCheck'
import { get36KrAiInformation, getAibaseNews, getWeiboHot } from '../../../services/api'

type RsshubTestSource = 'weiboHot' | 'aibaseNews' | 'kr36AiInformation'

type VersionSettingsPanelProps = {
  appVersion: string
  updateCheck: UpdateCheckState
  onCheckUpdate(options?: { force?: boolean }): Promise<unknown>
}

const rsshubTestSources: Array<{
  id: RsshubTestSource
  label: string
  path: string
  request: () => ReturnType<typeof getWeiboHot>
}> = [
  {
    id: 'weiboHot',
    label: 'Test Weibo hot',
    path: '/api/robbot/weibo/hot',
    request: () => getWeiboHot({ refresh: false }),
  },
  {
    id: 'aibaseNews',
    label: 'Test AIBase news',
    path: '/api/robbot/aibase/news',
    request: () => getAibaseNews({ refresh: false }),
  },
  {
    id: 'kr36AiInformation',
    label: 'Test 36Kr AI',
    path: '/api/robbot/36kr/information/AI',
    request: () => get36KrAiInformation({ refresh: false }),
  },
]

export function VersionSettingsPanel(props: VersionSettingsPanelProps) {
  const [testingRsshubSource, setTestingRsshubSource] = useState<RsshubTestSource | null>(null)

  const checkUpdate = async () => {
    await props.onCheckUpdate({ force: true })
  }

  const testRsshubSource = async (source: (typeof rsshubTestSources)[number]) => {
    setTestingRsshubSource(source.id)

    try {
      const result = await source.request()
      if (result.code !== 1 || !result.data) {
        toast.error(`${source.label} 请求失败：${result.msg || 'Request failed'}`)
        return
      }

      const staleText = result.data.stale ? '，返回旧缓存' : ''
      toast.success(`${source.label} 请求成功：${result.data.items.length} 条${staleText}`)
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
      toast.error(`打开下载链接失败：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  return (
    <div className="p-6">
      <h3 className="m-0 text-base font-semibold text-slate-950">Version</h3>
      <p className="mt-1 text-sm text-slate-500">Desktop app updates</p>

      <div className="mt-6 rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">Desktop update</div>
            <div className="mt-1 text-xs text-slate-500">
              Current version {props.appVersion || '—'} · {window.robbot.app.platform}/{window.robbot.app.arch}
            </div>
          </div>
          <button
            type="button"
            disabled={props.updateCheck.status === 'checking'}
            className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void checkUpdate()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${props.updateCheck.status === 'checking' ? 'animate-spin' : ''}`} />
            {props.updateCheck.status === 'checking' ? 'Checking...' : 'Check update'}
          </button>
        </div>

        {props.updateCheck.status === 'latest' ? (
          <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            You are using the latest version.
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
              New version available: {props.updateCheck.result.latestVersion}
              {props.updateCheck.result.forceUpdate ? ' · Required' : ''}
            </div>
            {props.updateCheck.result.releaseNotes ? (
              <div className="mt-1 whitespace-pre-wrap text-amber-700">{props.updateCheck.result.releaseNotes}</div>
            ) : null}
            {props.updateCheck.result.downloadUrl ? (
              <button
                type="button"
                className="mt-3 flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                onClick={() => void openUpdateDownload()}
              >
                <Download className="h-3.5 w-3.5" />
                Download installer
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div>
            <div className="text-sm font-medium text-slate-900">RSSHub test</div>
            <div className="mt-1 text-xs text-slate-500">Request RSSHub latest cache endpoints</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {rsshubTestSources.map((source) => {
              const testing = testingRsshubSource === source.id

              return (
                <button
                  key={source.id}
                  type="button"
                  title={`Request ${source.path}`}
                  disabled={testingRsshubSource !== null}
                  className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => void testRsshubSource(source)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Testing...' : source.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

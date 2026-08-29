import { useState } from 'react'
import { Box, FormControl, MenuItem, OutlinedInput, Select, Tab, Tabs } from '@mui/material'
import { Check, Download, Eye, EyeOff, LogOut, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateCheckState } from '../../hooks/useDesktopUpdateCheck'
import { get36KrAiInformation, getAibaseNews, getWeiboHot } from '../../services/api'

type AiField = 'deepseek' | 'openai'
type RsshubTestSource = 'weiboHot' | 'aibaseNews' | 'kr36AiInformation'

type SettingsModalProps = {
  open: boolean
  variant?: 'modal' | 'page'
  email: string
  deepseek: string | null
  openai: string | null
  selectedAi: string | null
  appVersion: string
  updateCheck: UpdateCheckState
  onCheckUpdate(options?: { force?: boolean }): Promise<unknown>
  onClose(): void
  onSave(field: AiField, value: Record<string, unknown>): Promise<void>
  onSelect(field: AiField): Promise<void>
  onLogout(): void
}

const emptyDeepseekConfig = '{}'
const emptyChatgptConfig = '{\n  "apiUrl": ""\n}'

const models = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
} as const

const fields: Array<{ field: AiField; label: string }> = [
  { field: 'deepseek', label: 'DeepSeek' },
  { field: 'openai', label: 'ChatGPT' },
]

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

function tabProps(index: number) {
  return {
    id: `settings-tab-${index}`,
    'aria-controls': `settings-tabpanel-${index}`,
  }
}

function TabPanel(props: { value: number; index: number; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      hidden={props.value !== props.index}
      id={`settings-tabpanel-${props.index}`}
      aria-labelledby={`settings-tab-${props.index}`}
      className="min-h-0 min-w-0 flex-1 overflow-y-auto"
    >
      {props.value === props.index ? props.children : null}
    </div>
  )
}

export function SettingsModal(props: SettingsModalProps) {
  const [tab, setTab] = useState(0)
  const [configs, setConfigs] = useState<Record<AiField, string>>(() => ({
    deepseek: formatJson(props.deepseek, emptyDeepseekConfig),
    openai: formatJson(props.openai, emptyChatgptConfig),
  }))
  const [keys, setKeys] = useState<Record<AiField, string>>(() => ({
    deepseek: readKey(props.deepseek),
    openai: readKey(props.openai),
  }))
  const [selectedModels, setSelectedModels] = useState<Record<AiField, string>>(() => ({
    deepseek: readStringValue(props.deepseek, 'model') || 'deepseek-v4-pro',
    openai: readStringValue(props.openai, 'model') || 'gpt-5.6-luna',
  }))
  const [showKeys, setShowKeys] = useState<Record<AiField, boolean>>({
    deepseek: false,
    openai: false,
  })
  const [saving, setSaving] = useState<AiField | null>(null)
  const [selecting, setSelecting] = useState<AiField | null>(null)
  const [testingRsshubSource, setTestingRsshubSource] = useState<RsshubTestSource | null>(null)

  const initialValues: Record<AiField, Record<string, unknown> | null> = {
    deepseek: normalizePersistedConfig(
      props.deepseek,
      readKey(props.deepseek),
      readStringValue(props.deepseek, 'model') || 'deepseek-v4-pro',
    ),
    openai: normalizePersistedConfig(
      props.openai,
      readKey(props.openai),
      readStringValue(props.openai, 'model') || 'gpt-5.6-luna',
    ),
  }

  if (!props.open) return null

  const close = () => {
    const selectedKey = props.selectedAi === 'deepseek' || props.selectedAi === 'openai'
      ? readKey(props[props.selectedAi]).trim()
      : ''

    if (!props.selectedAi || !selectedKey) {
      toast.warning('必须配置并选中一个 API key')
      return
    }

    props.onClose()
  }

  const save = async (field: AiField) => {
    const nextValue = nextConfigValue(field, configs, keys, selectedModels)
    if (!nextValue) {
      return
    }

    if (stableStringify(nextValue) === stableStringify(initialValues[field])) {
      toast.info('没有修改，无需保存')
      return
    }

    setSaving(field)

    try {
      await props.onSave(field, nextValue)
      toast.success(`${field === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} 配置保存成功`)
    } catch (cause) {
      toast.error(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSaving(null)
    }
  }

  const select = async (field: AiField) => {
    if (!keys[field].trim()) {
      toast.warning('请先配置 API key')
      return
    }

    const nextValue = nextConfigValue(field, configs, keys, selectedModels)
    if (!nextValue) {
      return
    }

    setSelecting(field)

    try {
      if (stableStringify(nextValue) !== stableStringify(initialValues[field])) {
        await props.onSave(field, nextValue)
        toast.success(`${field === 'deepseek' ? 'DeepSeek' : 'ChatGPT'} 配置保存成功`)
      } else {
        await props.onSelect(field)
      }
    } finally {
      setSelecting(null)
    }
  }

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

  const updatePanel = (
    <div className="rounded-lg border border-slate-200 p-4">
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
  )

  const content = (
    <div
      className={
        props.variant === 'page'
          ? 'h-full w-full overflow-hidden rounded-none bg-white'
          : 'w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl'
      }
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="m-0 text-lg font-semibold text-slate-950">Settings</h2>
          <p className="m-0 mt-1 text-xs text-slate-500">Account and AI models</p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          onClick={close}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Box
        sx={{
          display: 'flex',
          height: props.variant === 'page' ? 'calc(100% - 65px)' : 470,
          minHeight: 0,
          minWidth: 0,
          maxHeight: props.variant === 'page' ? 'none' : '70vh',
          overflow: 'hidden',
        }}
      >
        <Tabs
          orientation="vertical"
          value={tab}
          onChange={(_, value: number) => setTab(value)}
          aria-label="Settings sections"
          sx={{
            width: 150,
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              alignItems: 'flex-start',
              minHeight: 48,
              textTransform: 'none',
              fontSize: 13,
            },
          }}
        >
          <Tab label="Model" {...tabProps(0)} />
          <Tab label="Account" {...tabProps(1)} />
          <Tab
            label={(
              <span className="relative inline-flex items-center">
                Version
                {props.updateCheck.status === 'available' ? (
                  <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-rose-500" />
                ) : null}
              </span>
            )}
            {...tabProps(2)}
          />
        </Tabs>

        <TabPanel value={tab} index={0}>
          <div className="p-6">
            <h3 className="m-0 text-base font-semibold text-slate-950">Model</h3>
            <p className="mt-1 text-sm text-slate-500">
              API key is protected in a password field.
              新配置将在下一次发送消息时生效；当前正在运行的任务不会受到影响。
            </p>

            <div className="mt-6 grid gap-5">
              {fields.map(({ field, label }) => {
                const active = props.selectedAi === field

                return (
                  <div key={field} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-slate-800">{label}</div>

                      {active ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <Check className="h-3.5 w-3.5" />
                          当前正在使用
                        </span>
                      ) : (
                        <button
                          disabled={selecting !== null}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          onClick={() => void select(field)}
                        >
                          {selecting === field ? '切换中…' : '选中'}
                        </button>
                      )}
                    </div>

                    <label className="mt-3 block text-xs font-medium text-slate-600">
                      API key
                    </label>
                    <div className="relative mt-1">
                      <input
                        type={showKeys[field] ? 'text' : 'password'}
                        value={keys[field]}
                        onChange={(event) =>
                          setKeys((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        className="w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm outline-none focus:border-emerald-500"
                        placeholder="Enter API key"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                        onClick={() =>
                          setShowKeys((current) => ({
                            ...current,
                            [field]: !current[field],
                          }))
                        }
                        aria-label={showKeys[field] ? 'Hide API key' : 'Show API key'}
                        title={showKeys[field] ? 'Hide API key' : 'Show API key'}
                      >
                        {showKeys[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <label className="mt-3 block text-xs font-medium text-slate-600">Model</label>
                    <FormControl fullWidth size="small" className="mt-1">
                      <Select
                        value={selectedModels[field]}
                        onChange={(event) =>
                          setSelectedModels((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        input={<OutlinedInput />}
                        MenuProps={{
                          slotProps: {
                            paper: {
                              style: {
                                maxHeight: 48 * 4.5 + 8,
                                width: 250,
                              },
                            },
                          },
                        }}
                      >
                        {models[field].map((model) => (
                          <MenuItem key={model} value={model}>
                            {model}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    {field === 'openai' ? (
                      <>
                        <label className="mt-3 block text-xs font-medium text-slate-600">
                          Other configuration (JSON)
                        </label>
                        <textarea
                          value={configs[field]}
                          onChange={(event) =>
                            setConfigs((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          className="mt-1 min-h-32 w-full resize-y rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-emerald-500"
                          spellCheck={false}
                        />
                      </>
                    ) : null}

                    <div className="mt-3 flex justify-end">
                      <button
                        disabled={saving !== null}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        onClick={() => void save(field)}
                      >
                        {saving === field ? '保存中…' : '保存'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </TabPanel>

        <TabPanel value={tab} index={1}>
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
        </TabPanel>

        <TabPanel value={tab} index={2}>
          <div className="p-6">
            <h3 className="m-0 text-base font-semibold text-slate-950">Version</h3>
            <p className="mt-1 text-sm text-slate-500">Desktop app updates</p>

            <div className="mt-6">{updatePanel}</div>
          </div>
        </TabPanel>
      </Box>
    </div>
  )

  if (props.variant === 'page') {
    return <div className="h-full min-h-0 bg-white">{content}</div>
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4"
      onMouseDown={close}
    >
      {content}
    </div>
  )
}

function nextConfigValue(field: AiField, configs: Record<AiField, string>, keys: Record<AiField, string>, selectedModels: Record<AiField, string>): Record<string, unknown> | null {
  let value: Record<string, unknown>

  try {
    value = JSON.parse(configs[field]) as Record<string, unknown>
  } catch {
    toast.error('保存失败：请输入有效的 JSON 对象')
    return null
  }

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    toast.error('保存失败：配置必须是 JSON 对象')
    return null
  }

  return normalizeConfig(value, keys[field].trim(), selectedModels[field])
}

function normalizeConfig(value: Record<string, unknown>, key: string, model: string): Record<string, unknown> {
  const withoutManagedFields = Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== 'key' && name !== 'model'),
  )

  return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}), model }) as Record<string, unknown>
}

function normalizePersistedConfig(raw: string | null, key: string, model: string): Record<string, unknown> | null {
  if (!raw) return normalizeConfig({}, key, model)
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || Array.isArray(value) || typeof value !== 'object') return null
    return normalizeConfig(value, key, model)
  } catch {
    return null
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>

    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, sortValue(object[key])]),
    )
  }

  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function formatJson(raw: string | null, emptyValue: string): string {
  if (!raw) return emptyValue

  try {
    const value = JSON.parse(raw) as Record<string, unknown>

    delete value.key
    delete value.model

    return JSON.stringify(value, null, 2)
  } catch {
    return raw
  }
}

function readKey(raw: string | null): string {
  if (!raw) return ''

  try {
    const value = JSON.parse(raw) as Record<string, unknown>

    return typeof value.key === 'string' ? value.key : ''
  } catch {
    return ''
  }
}

function readStringValue(raw: string | null, field: string): string {
  if (!raw) return ''

  try {
    const value = JSON.parse(raw) as Record<string, unknown>

    return typeof value[field] === 'string' ? value[field] : ''
  } catch {
    return ''
  }
}

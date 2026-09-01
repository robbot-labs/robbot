import { useState } from 'react'
import { FormControl, MenuItem, OutlinedInput, Select } from '@mui/material'
import type { AiField } from '@robbot/core'
import type { TFunction } from 'i18next'
import { Bot, Braces, Check, Eye, EyeOff, Flame, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsButton } from '../../common/SettingsButton'
import { SubmitButton } from '../../common/SubmitButton'
import { readAiConfigKey } from './aiConfig'

type ModelSettingsPanelProps = {
  deepseek: string | null
  openai: string | null
  volcengine: string | null
  customOpenai: string | null
  selectedAi: string | null
  onSave(field: AiField, value: Record<string, unknown>): Promise<void>
  onSelect(field: AiField): Promise<void>
}

const deepseekDefaultModel = 'deepseek-v4-pro'
const emptyDeepseekConfig = `{\n  "model": "${deepseekDefaultModel}"\n}`
const openaiDefaultModel = 'gpt-5.6-luna'
const emptyChatgptConfig = `{\n  "model": "${openaiDefaultModel}",\n  "apiUrl": ""\n}`
const volcengineCodingBaseUrl = 'https://ark.cn-beijing.volces.com/api/coding/v3'
const volcengineDefaultModel = 'ark-code-latest'
const emptyVolcengineConfig = `{\n  "model": "${volcengineDefaultModel}",\n  "apiUrl": "${volcengineCodingBaseUrl}"\n}`
const emptyCustomOpenaiConfig = '{\n  "model": "",\n  "apiUrl": ""\n}'

const models = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
  volcengine: ['ark-code-latest'],
} as const

const fields: Array<{ field: AiField; label: string; description: string; icon: LucideIcon; accent: string }> = [
  {
    field: 'customOpenai',
    label: '自定义 OpenAI',
    description: '支持任意兼容 OpenAI 接口协议的模型',
    icon: Braces,
    accent: 'bg-violet-50 text-violet-600 ring-violet-100',
  },
  {
    field: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek 官方模型服务',
    icon: Sparkles,
    accent: 'bg-blue-50 text-blue-600 ring-blue-100',
  },
  {
    field: 'openai',
    label: 'OpenAI (ChatGPT)',
    description: 'OpenAI 官方模型服务',
    icon: Bot,
    accent: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  },
  {
    field: 'volcengine',
    label: '火山 Coding Plan',
    description: '火山引擎方舟代码模型服务',
    icon: Flame,
    accent: 'bg-orange-50 text-orange-600 ring-orange-100',
  },
]

export function ModelSettingsPanel(props: ModelSettingsPanelProps) {
  const { t } = useTranslation()
  const [configs, setConfigs] = useState<Record<AiField, string>>(() => ({
    deepseek: formatJson(props.deepseek, emptyDeepseekConfig, 'deepseek'),
    openai: formatJson(props.openai, emptyChatgptConfig, 'openai'),
    volcengine: formatJson(props.volcengine, emptyVolcengineConfig, 'volcengine'),
    customOpenai: formatJson(props.customOpenai, emptyCustomOpenaiConfig, 'customOpenai'),
  }))
  const [keys, setKeys] = useState<Record<AiField, string>>(() => ({
    deepseek: readAiConfigKey(props.deepseek),
    openai: readAiConfigKey(props.openai),
    volcengine: readAiConfigKey(props.volcengine),
    customOpenai: readAiConfigKey(props.customOpenai),
  }))
  const [selectedModels, setSelectedModels] = useState<Record<AiField, string>>(() => ({
    deepseek: readStringValue(props.deepseek, 'model') || deepseekDefaultModel,
    openai: readStringValue(props.openai, 'model') || openaiDefaultModel,
    volcengine: readStringValue(props.volcengine, 'model') || volcengineDefaultModel,
    customOpenai: '',
  }))
  const [showKeys, setShowKeys] = useState<Record<AiField, boolean>>({
    deepseek: false,
    openai: false,
    volcengine: false,
    customOpenai: false,
  })
  const [saving, setSaving] = useState<AiField | null>(null)
  const [selecting, setSelecting] = useState<AiField | null>(null)

  const initialValues: Record<AiField, Record<string, unknown> | null> = {
    deepseek: normalizePersistedConfig(
      props.deepseek,
      readAiConfigKey(props.deepseek),
      readStringValue(props.deepseek, 'model') || deepseekDefaultModel,
      'deepseek',
    ),
    openai: normalizePersistedConfig(
      props.openai,
      readAiConfigKey(props.openai),
      readStringValue(props.openai, 'model') || openaiDefaultModel,
      'openai',
    ),
    volcengine: normalizePersistedConfig(
      props.volcengine,
      readAiConfigKey(props.volcengine),
      readStringValue(props.volcengine, 'model') || volcengineDefaultModel,
      'volcengine',
    ),
    customOpenai: normalizePersistedConfig(
      props.customOpenai,
      readAiConfigKey(props.customOpenai),
      '',
      'customOpenai',
    ),
  }

  const save = async (field: AiField) => {
    const nextValue = nextConfigValue(field, configs, keys, selectedModels, t)
    if (!nextValue) {
      return
    }

    if (stableStringify(nextValue) === stableStringify(initialValues[field])) {
      toast.info(t('settings.model.noChanges'), { duration: 1000 })
      return
    }

    setSaving(field)

    try {
      await props.onSave(field, nextValue)
      toast.success(t('settings.model.saveSuccess', { provider: providerLabel(field) }), { duration: 1000 })
    } catch (cause) {
      toast.error(t('settings.model.saveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setSaving(null)
    }
  }

  const select = async (field: AiField) => {
    if (!keys[field].trim()) {
      toast.warning(t('settings.model.missingKey'), { duration: 1000 })
      return
    }

    const nextValue = nextConfigValue(field, configs, keys, selectedModels, t)
    if (!nextValue) {
      return
    }

    setSelecting(field)

    try {
      if (stableStringify(nextValue) !== stableStringify(initialValues[field])) {
        await props.onSave(field, nextValue)
        toast.success(t('settings.model.saveSuccess', { provider: providerLabel(field) }), { duration: 1000 })
      } else {
        await props.onSelect(field)
      }
    } finally {
      setSelecting(null)
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <h3 className="m-0 text-lg font-semibold tracking-tight text-slate-950">{t('settings.model.title')}</h3>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">{t('settings.model.description')}</p>
      </div>

      <div className="mt-6 grid gap-4">
        {fields.map(({ field, label, description, icon: ProviderIcon, accent }) => {
          const active = props.selectedAi === field

          return (
            <section
              key={field}
              className={`overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow] ${
                active
                  ? 'border-emerald-300 shadow-[0_0_0_3px_rgb(16_185_129/0.08)]'
                  : 'border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 ${active ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100 bg-slate-50/60'}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset ${accent}`}>
                    <ProviderIcon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{label}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{description}</div>
                  </div>
                </div>

                {active ? (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    {t('settings.model.active')}
                  </span>
                ) : (
                  <SettingsButton
                    disabled={selecting !== null}
                    onClick={() => void select(field)}
                  >
                    {selecting === field ? t('settings.model.selecting') : t('settings.model.select')}
                  </SettingsButton>
                )}
              </div>

              <div className="p-4">
                <label className="block text-xs font-semibold text-slate-700">{t('settings.model.apiKey')}</label>
                <div className="relative mt-1.5">
                  <input
                    type={showKeys[field] ? 'text' : 'password'}
                    value={keys[field]}
                    onChange={(event) =>
                      setKeys((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/10"
                    placeholder={t('settings.model.apiKeyPlaceholder')}
                    autoComplete="new-password"
                  />
                  <SettingsButton
                    iconOnly
                    className="rounded-r-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
                    onClick={() =>
                      setShowKeys((current) => ({
                        ...current,
                        [field]: !current[field],
                      }))
                    }
                    aria-label={showKeys[field] ? t('settings.model.hideApiKey') : t('settings.model.showApiKey')}
                    title={showKeys[field] ? t('settings.model.hideApiKey') : t('settings.model.showApiKey')}
                  >
                    {showKeys[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </SettingsButton>
                </div>

                {isPresetModelProvider(field) ? (
                  <>
                    <label className="mt-4 block text-xs font-semibold text-slate-700">{t('settings.model.title')}</label>
                    <FormControl fullWidth size="small" className="mt-1.5">
                      <Select
                        value={selectedModels[field]}
                        onChange={(event) => {
                          const nextModel = event.target.value
                          setSelectedModels((current) => ({
                            ...current,
                            [field]: nextModel,
                          }))
                          if (isConfigModelProvider(field)) {
                            setConfigs((current) => ({
                              ...current,
                              [field]: updateConfigModel(current[field], nextModel),
                            }))
                          }
                        }}
                        input={<OutlinedInput />}
                        sx={{
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                          boxShadow: '0 1px 2px rgb(15 23 42 / 0.05)',
                          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgb(203 213 225)' },
                          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgb(148 163 184)' },
                          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgb(99 102 241)' },
                        }}
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
                        {modelOptions(field, selectedModels[field]).map((model) => (
                          <MenuItem key={model} value={model}>
                            {model}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                ) : null}

                {field === 'deepseek' || field === 'openai' || field === 'volcengine' || field === 'customOpenai' ? (
                  <>
                    <label className="mt-4 block text-xs font-semibold text-slate-700">{t('settings.model.otherConfiguration')}</label>
                    <textarea
                      value={configs[field]}
                      onChange={(event) => {
                        const nextConfig = event.target.value
                        setConfigs((current) => ({
                          ...current,
                          [field]: nextConfig,
                        }))
                        if (isConfigModelProvider(field)) {
                          const nextModel = readStringValue(nextConfig, 'model')
                          if (nextModel) {
                            setSelectedModels((current) => ({
                              ...current,
                              [field]: nextModel,
                            }))
                          }
                        }
                      }}
                      className="mt-1.5 min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-slate-950 px-3.5 py-3 font-mono text-xs leading-5 text-slate-100 shadow-inner outline-none transition placeholder:text-slate-500 hover:border-slate-400 focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/10"
                      spellCheck={false}
                    />
                  </>
                ) : null}

                <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
                  <SubmitButton
                    className="min-w-20 shadow-sm"
                    disabled={saving !== null}
                    onClick={() => void save(field)}
                  >
                    {saving === field ? t('common.saving') : t('common.save')}
                  </SubmitButton>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function providerLabel(field: AiField): string {
  if (field === 'deepseek') return 'DeepSeek'
  if (field === 'openai') return 'ChatGPT'
  if (field === 'customOpenai') return '支持任意兼容 OpenAI 接口协议模型'
  return '火山coding plan'
}

function isPresetModelProvider(field: AiField): field is keyof typeof models {
  return field === 'deepseek' || field === 'openai' || field === 'volcengine'
}

function isConfigModelProvider(field: AiField): field is 'deepseek' | 'openai' | 'volcengine' {
  return field === 'deepseek' || field === 'openai' || field === 'volcengine'
}

function modelOptions(field: keyof typeof models, selectedModel: string): string[] {
  const options: string[] = [...models[field]]
  if (selectedModel && !options.includes(selectedModel)) {
    options.push(selectedModel)
  }
  return options
}

function updateConfigModel(raw: string, model: string): string {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return raw
    }
    return JSON.stringify({ ...value, model }, null, 2)
  } catch {
    return raw
  }
}

function nextConfigValue(field: AiField, configs: Record<AiField, string>, keys: Record<AiField, string>, selectedModels: Record<AiField, string>, t: TFunction): Record<string, unknown> | null {
  let value: Record<string, unknown>

  try {
    value = JSON.parse(configs[field]) as Record<string, unknown>
  } catch {
    toast.error(t('settings.model.invalidJson'))
    return null
  }

  if (!value || Array.isArray(value) || typeof value !== 'object') {
    toast.error(t('settings.model.jsonObjectRequired'))
    return null
  }

  return normalizeConfig(value, keys[field].trim(), selectedModels[field], field, t)
}

function normalizeConfig(value: Record<string, unknown>, key: string, model: string, field?: AiField, t?: TFunction): Record<string, unknown> | null {
  const withoutManagedFields = Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'key'))
  if (field !== 'customOpenai' && field !== 'openai' && field !== 'deepseek' && field !== 'volcengine') {
    delete withoutManagedFields.model
  }
  if (field === 'deepseek') {
    delete withoutManagedFields.apiUrl
  }
  if (field === 'volcengine') {
    withoutManagedFields.apiUrl = normalizeVolcengineApiUrl(withoutManagedFields.apiUrl)
  }
  if (field === 'customOpenai') {
    const customModel = stringValue(withoutManagedFields.model)
    const apiUrl = stringValue(withoutManagedFields.apiUrl)
    if (!customModel || !apiUrl) {
      if (t) {
        toast.error(t('settings.model.invalidJson'))
      }
      return null
    }
    withoutManagedFields.model = customModel
    withoutManagedFields.apiUrl = apiUrl
    return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}) }) as Record<string, unknown>
  }
  if (field === 'openai') {
    const openaiModel = stringValue(withoutManagedFields.model) || model
    withoutManagedFields.model = openaiModel
    return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}) }) as Record<string, unknown>
  }
  if (field === 'deepseek') {
    const deepseekModel = stringValue(withoutManagedFields.model) || model
    withoutManagedFields.model = deepseekModel
    return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}) }) as Record<string, unknown>
  }
  if (field === 'volcengine') {
    const volcengineModel = stringValue(withoutManagedFields.model) || model
    withoutManagedFields.model = volcengineModel
    return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}) }) as Record<string, unknown>
  }

  return sortValue({ ...withoutManagedFields, ...(key ? { key } : {}), model }) as Record<string, unknown>
}

function normalizePersistedConfig(raw: string | null, key: string, model: string, field?: AiField): Record<string, unknown> | null {
  if (!raw) return normalizeConfig({}, key, model, field)
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || Array.isArray(value) || typeof value !== 'object') return null
    return normalizeConfig(value, key, model, field)
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

function formatJson(raw: string | null, emptyValue: string, field?: AiField): string {
  if (!raw) return emptyValue

  try {
    const value = JSON.parse(raw) as Record<string, unknown>

    delete value.key
    if (field !== 'customOpenai' && field !== 'openai' && field !== 'deepseek' && field !== 'volcengine') {
      delete value.model
    }
    if (field === 'deepseek') {
      delete value.apiUrl
    }
    if (field === 'volcengine') {
      value.apiUrl = normalizeVolcengineApiUrl(value.apiUrl)
    }

    return JSON.stringify(value, null, 2)
  } catch {
    return raw
  }
}

function normalizeVolcengineApiUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return volcengineCodingBaseUrl

  const apiUrl = value.trim()
  if (apiUrl === 'https://ark.cn-beijing.volces.com/api/v3' || apiUrl === 'https://ark.cn-beijing.volces.com/api/coding') {
    return volcengineCodingBaseUrl
  }
  return apiUrl
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

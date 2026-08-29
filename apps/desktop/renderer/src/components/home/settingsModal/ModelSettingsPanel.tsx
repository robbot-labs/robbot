import { useState } from 'react'
import { FormControl, MenuItem, OutlinedInput, Select } from '@mui/material'
import { Check, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

export type AiField = 'deepseek' | 'openai'

type ModelSettingsPanelProps = {
  deepseek: string | null
  openai: string | null
  selectedAi: string | null
  onSave(field: AiField, value: Record<string, unknown>): Promise<void>
  onSelect(field: AiField): Promise<void>
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

export function ModelSettingsPanel(props: ModelSettingsPanelProps) {
  const [configs, setConfigs] = useState<Record<AiField, string>>(() => ({
    deepseek: formatJson(props.deepseek, emptyDeepseekConfig),
    openai: formatJson(props.openai, emptyChatgptConfig),
  }))
  const [keys, setKeys] = useState<Record<AiField, string>>(() => ({
    deepseek: readAiConfigKey(props.deepseek),
    openai: readAiConfigKey(props.openai),
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

  const initialValues: Record<AiField, Record<string, unknown> | null> = {
    deepseek: normalizePersistedConfig(
      props.deepseek,
      readAiConfigKey(props.deepseek),
      readStringValue(props.deepseek, 'model') || 'deepseek-v4-pro',
    ),
    openai: normalizePersistedConfig(
      props.openai,
      readAiConfigKey(props.openai),
      readStringValue(props.openai, 'model') || 'gpt-5.6-luna',
    ),
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

  return (
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

              <label className="mt-3 block text-xs font-medium text-slate-600">API key</label>
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
                  <label className="mt-3 block text-xs font-medium text-slate-600">Other configuration (JSON)</label>
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

export function readAiConfigKey(raw: string | null): string {
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

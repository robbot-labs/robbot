import { useEffect, useMemo, useState } from 'react'
import { Switch } from '@mui/material'
import { Plug, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type {
  RuntimePluginDiagnostic,
  RuntimePluginManifestEntry,
  RuntimePluginSettingsResult,
  SingleSlotConflict,
} from '../../../robbot-api'

type RuntimePluginsPanelProps = {
  onRuntimePluginsChanged?(): Promise<void>
}

type ExclusivePluginGroup = {
  slot: string
  plugins: Array<{ name: string; displayName?: string }>
}

const NO_EXCLUSIVE_OWNER = '__none__'

export function RuntimePluginsPanel(props: RuntimePluginsPanelProps) {
  const [pluginSettings, setPluginSettings] = useState<RuntimePluginSettingsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    void loadRuntimePlugins()
  }, [])

  const groups = useMemo(() => exclusiveGroups(pluginSettings), [pluginSettings])
  const groupedPluginNames = useMemo(
    () => new Set(groups.flatMap((group) => group.plugins.map((plugin) => plugin.name))),
    [groups],
  )
  const standalonePlugins = useMemo(
    () => pluginSettings?.plugins.filter((plugin) => !groupedPluginNames.has(plugin.name)) ?? [],
    [groupedPluginNames, pluginSettings],
  )
  const pluginByName = useMemo(
    () => new Map((pluginSettings?.plugins ?? []).map((plugin) => [plugin.name, plugin])),
    [pluginSettings],
  )

  async function loadRuntimePlugins() {
    setLoading(true)
    try {
      setPluginSettings(await window.robbot.harness.getRuntimePlugins())
    } catch (cause) {
      toast.error(`插件列表加载失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setLoading(false)
    }
  }

  async function setStandaloneEnabled(name: string, enabled: boolean) {
    setSaving(name)
    try {
      const next = await window.robbot.harness.setRuntimePluginEnabled({ name, enabled })
      setPluginSettings(next)
      await afterPluginChange(next, `${name} 已${enabled ? '启用' : '停用'}`)
    } catch (cause) {
      toast.error(`插件切换失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSaving(null)
    }
  }

  async function selectExclusiveOwner(group: ExclusivePluginGroup, ownerName: string | null) {
    setSaving(group.slot)
    try {
      const next = await window.robbot.harness.setRuntimePluginsEnabled({
        updates: group.plugins.map((plugin) => ({
          name: plugin.name,
          enabled: ownerName !== null && plugin.name === ownerName,
        })),
      })
      setPluginSettings(next)
      await afterPluginChange(
        next,
        ownerName === null ? `${group.slot} owner 已设为 NONE` : `${labelForPlugin({ name: ownerName })} 已选为 ${group.slot} owner`,
      )
    } catch (cause) {
      toast.error(`插件切换失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setSaving(null)
    }
  }

  async function afterPluginChange(next: RuntimePluginSettingsResult, successMessage: string) {
    if (!next.resolution.ok) {
      toast.warning(`${successMessage}，但当前插件配置仍有冲突`)
      return
    }
    toast.success(`${successMessage}，正在重新加载 HARNESS`)
    await props.onRuntimePluginsChanged?.()
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900">Runtime plugins</div>
          <div className="mt-1 text-xs text-slate-500">冲突插件单选，普通插件可多选启用。</div>
        </div>
        <button
          type="button"
          disabled={loading}
          className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void loadRuntimePlugins()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {pluginSettings?.resolution.ok === false ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          <div className="font-medium">当前插件配置存在冲突</div>
          <div className="mt-1 whitespace-pre-wrap">{pluginSettings.resolution.diagnostics.map(formatRuntimePluginDiagnostic).join('\n')}</div>
        </div>
      ) : null}

      {loading && !pluginSettings ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 p-4 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading plugins...
        </div>
      ) : null}

      {pluginSettings && pluginSettings.plugins.length === 0 ? (
        <div className="mt-4 rounded-md border border-slate-200 p-4 text-sm text-slate-500">No runtime plugins declared.</div>
      ) : null}

      {groups.length > 0 ? (
        <div className="mt-4 space-y-4">
          {groups.map((group) => (
            <fieldset key={group.slot} className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
              <legend className="px-1 text-[12px] font-medium uppercase tracking-wide text-amber-700">{group.slot} owner</legend>
              <div className="mt-2 divide-y divide-amber-100 rounded-md border border-amber-100 bg-white">
                {group.plugins.map((plugin) => {
                  const manifestPlugin = pluginByName.get(plugin.name)
                  const checked = manifestPlugin?.enabled === true

                  return (
                    <label key={plugin.name} className="flex cursor-pointer items-center justify-between gap-4 p-3 hover:bg-amber-50/50">
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <Plug className="h-4 w-4 text-amber-500" />
                          <span className="truncate text-sm font-medium text-slate-900">{labelForPlugin(plugin)}</span>
                        </span>
                        <PluginMeta plugin={manifestPlugin} />
                      </span>
                      <input
                        type="radio"
                        name={`runtime-plugin-owner-${group.slot}`}
                        checked={checked}
                        disabled={saving !== null}
                        onChange={() => void selectExclusiveOwner(group, plugin.name)}
                      />
                    </label>
                  )
                })}

                {/* <label className="flex cursor-pointer items-center justify-between gap-4 p-3 hover:bg-amber-50/50">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Plug className="h-4 w-4 text-slate-300" />
                      <span className="truncate text-sm font-medium text-slate-900">NONE</span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">不启用任何 {group.slot} owner UI 插件</span>
                  </span>
                  <input
                    type="radio"
                    name={`runtime-plugin-owner-${group.slot}`}
                    value={NO_EXCLUSIVE_OWNER}
                    checked={group.plugins.every((plugin) => pluginByName.get(plugin.name)?.enabled !== true)}
                    disabled={saving !== null}
                    onChange={() => void selectExclusiveOwner(group, null)}
                  />
                </label> */}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {standalonePlugins.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Non-conflicting plugins</div>
          <div className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {standalonePlugins.map((plugin) => (
              <div key={plugin.name} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plug className="h-4 w-4 text-slate-400" />
                    <span className="truncate text-sm font-medium text-slate-900">{plugin.name}</span>
                  </div>
                  <PluginMeta plugin={plugin} />
                </div>
                <Switch
                  checked={plugin.enabled}
                  disabled={saving !== null}
                  onChange={(_, checked) => void setStandaloneEnabled(plugin.name, checked)}
                  inputProps={{ 'aria-label': `${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}` }}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PluginMeta(props: { plugin: RuntimePluginManifestEntry | undefined }) {
  const plugin = props.plugin
  if (!plugin) {
    return <span className="mt-1 block text-xs text-slate-500">Not declared in manifest</span>
  }

  return (
    <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
      <span>{plugin.enabled ? 'Enabled' : 'Disabled'}</span>
      {plugin.source ? <span>Source: {plugin.source}</span> : null}
    </span>
  )
}

function exclusiveGroups(settings: RuntimePluginSettingsResult | null): ExclusivePluginGroup[] {
  if (!settings) {
    return []
  }

  if (!settings.resolution.ok) {
    return settings.resolution.diagnostics
      .filter(isSingleSlotConflict)
      .map((diagnostic) => ({ slot: diagnostic.slot, plugins: diagnostic.plugins }))
  }

  const ownersBySlot = new Map<string, Array<{ name: string; displayName?: string }>>()
  for (const plugin of settings.resolution.plan.plugins) {
    for (const registration of plugin.registrations) {
      if (registration.role !== 'owner') {
        continue
      }
      const owners = ownersBySlot.get(registration.slot) ?? []
      owners.push({ name: plugin.name, displayName: plugin.displayName })
      ownersBySlot.set(registration.slot, owners)
    }
  }

  return [...ownersBySlot]
    .filter(([, plugins]) => plugins.length > 1)
    .map(([slot, plugins]) => ({ slot, plugins }))
}

function isSingleSlotConflict(diagnostic: RuntimePluginDiagnostic): diagnostic is SingleSlotConflict {
  return diagnostic.type === 'single-slot-conflict'
}

function labelForPlugin(plugin: { name: string; displayName?: string }) {
  return plugin.displayName ?? plugin.name
}

function formatRuntimePluginDiagnostic(diagnostic: RuntimePluginDiagnostic): string {
  if (diagnostic.type === 'single-slot-conflict') {
    return `single slot "${diagnostic.slot}" has multiple owners: ${diagnostic.plugins.map(labelForPlugin).join(', ')}`
  }
  if (diagnostic.type === 'missing-plugin') {
    return `enabled plugin is missing: ${labelForPlugin(diagnostic.plugin)}`
  }
  if (diagnostic.type === 'unknown-slot-registration') {
    return `unknown slot registration in ${labelForPlugin(diagnostic.plugin)}: ${diagnostic.slot}`
  }
  if (diagnostic.type === 'invalid-ui-registration') {
    return `invalid UI registration in ${labelForPlugin(diagnostic.plugin)}: ${diagnostic.message}`
  }
  return 'Runtime plugin diagnostic'
}

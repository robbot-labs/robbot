import { useCallback, useEffect, useMemo, useState } from 'react'
import { Switch } from '@mui/material'
import type { TFunction } from 'i18next'
import { Plug, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsButton } from '../../common/SettingsButton'
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

// const NO_EXCLUSIVE_OWNER = '__none__'

export function RuntimePluginsPanel(props: RuntimePluginsPanelProps) {
  const { t } = useTranslation()
  const [pluginSettings, setPluginSettings] = useState<RuntimePluginSettingsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

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

  const loadRuntimePlugins = useCallback(async () => {
    setLoading(true)
    try {
      setPluginSettings(await window.robbot.harness.getRuntimePlugins())
    } catch (cause) {
      toast.error(t('settings.plugins.loadFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    queueMicrotask(() => void loadRuntimePlugins())
  }, [loadRuntimePlugins])

  async function setStandaloneEnabled(name: string, enabled: boolean) {
    setSaving(name)
    try {
      const next = await window.robbot.harness.setRuntimePluginEnabled({ name, enabled })
      setPluginSettings(next)
      await afterPluginChange(next, t(enabled ? 'settings.plugins.enabled' : 'settings.plugins.disabled', { name }))
    } catch (cause) {
      toast.error(t('settings.plugins.toggleFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
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
        ownerName === null
          ? t('settings.plugins.ownerNone', { slot: group.slot })
          : t('settings.plugins.ownerSelected', { name: labelForPlugin({ name: ownerName }), slot: group.slot }),
      )
    } catch (cause) {
      toast.error(t('settings.plugins.toggleFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setSaving(null)
    }
  }

  async function afterPluginChange(next: RuntimePluginSettingsResult, successMessage: string) {
    if (!next.resolution.ok) {
      toast.warning(t('settings.plugins.stillConflicts', { message: successMessage }), { duration: 1000 })
      return
    }
    toast.success(t('settings.plugins.reloadingHarness', { message: successMessage }), { duration: 1000 })
    await props.onRuntimePluginsChanged?.()
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900">{t('settings.plugins.runtimeTitle')}</div>
          <div className="mt-1 text-xs text-slate-500">{t('settings.plugins.runtimeDescription')}</div>
        </div>
        <SettingsButton
          disabled={loading}
          onClick={() => void loadRuntimePlugins()}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </SettingsButton>
      </div>

      {pluginSettings?.resolution.ok === false ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          <div className="font-medium">{t('settings.plugins.conflictTitle')}</div>
          <div className="mt-1 whitespace-pre-wrap">{pluginSettings.resolution.diagnostics.map((diagnostic) => formatRuntimePluginDiagnostic(diagnostic, t)).join('\n')}</div>
        </div>
      ) : null}

      {loading && !pluginSettings ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 p-4 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {t('settings.plugins.loading')}
        </div>
      ) : null}

      {pluginSettings && pluginSettings.plugins.length === 0 ? (
        <div className="mt-4 rounded-md border border-slate-200 p-4 text-sm text-slate-500">{t('settings.plugins.empty')}</div>
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
                        className="cursor-pointer"
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
                    <span className="mt-1 block text-xs text-slate-500">{t('settings.plugins.noneDescription', { slot: group.slot })}</span>
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
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t('settings.plugins.nonConflicting')}</div>
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
                  sx={{ cursor: 'pointer' }}
                  onChange={(_, checked) => void setStandaloneEnabled(plugin.name, checked)}
                  inputProps={{ 'aria-label': t(plugin.enabled ? 'settings.plugins.disablePlugin' : 'settings.plugins.enablePlugin', { name: plugin.name }) }}
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
  const { t } = useTranslation()
  const plugin = props.plugin
  if (!plugin) {
    return <span className="mt-1 block text-xs text-slate-500">{t('settings.plugins.notDeclared')}</span>
  }

  return (
    <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
      <span>{plugin.enabled ? t('common.enabled') : t('common.disabled')}</span>
      {plugin.source ? <span>{t('settings.plugins.source', { source: plugin.source })}</span> : null}
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

function formatRuntimePluginDiagnostic(diagnostic: RuntimePluginDiagnostic, t: TFunction): string {
  if (diagnostic.type === 'single-slot-conflict') {
    return t('diagnostics.singleSlotConflict', { slot: diagnostic.slot, owners: diagnostic.plugins.map(labelForPlugin).join(', ') })
  }
  if (diagnostic.type === 'missing-plugin') {
    return t('diagnostics.missingPlugin', { plugin: labelForPlugin(diagnostic.plugin) })
  }
  if (diagnostic.type === 'unknown-slot-registration') {
    return t('diagnostics.unknownSlotRegistration', { plugin: labelForPlugin(diagnostic.plugin), slot: diagnostic.slot })
  }
  if (diagnostic.type === 'invalid-ui-registration') {
    return t('diagnostics.invalidUiRegistration', { plugin: labelForPlugin(diagnostic.plugin), message: diagnostic.message })
  }
  return t('diagnostics.runtimePluginDiagnostic')
}

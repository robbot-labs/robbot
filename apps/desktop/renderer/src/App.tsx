import { useEffect, useRef, useState } from 'react'
import { LogOut, Plug, RefreshCw, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LoginPage } from './components/auth/LoginPage'
import { SettingsModal } from './components/home/settingsModal/SettingsModal'
import { useDesktopUpdateCheck } from './hooks/useDesktopUpdateCheck'
import type { AccountRecord, AuthUser, DshWebViewTarget, RuntimePluginDiagnostic, SingleSlotConflict } from './robbot-api'
import './App.css'

const DSH_BRAND_CSS = `
button[class*="brand"] svg {
  display: none !important;
}

button[class*="brand"] span[class*="brandName"],
button[class*="brand"] [data-slot="sidebar.brand.name"],
button:has([data-slot="sidebar.brand.name"]) span[class*="brandName"] {
  display: none !important;
}

button[class*="brand"]::before {
  content: "Robbot";
  color: currentColor;
  font: 700 20px/24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}

button[class*="toggle"]:has([data-slot="sidebar.brand.mark"]) [data-slot="sidebar.brand.mark"] svg {
  display: none !important;
}

button[class*="toggle"]:has([data-slot="sidebar.brand.mark"])::before {
  content: "R";
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 6px;
  background: #0f1115;
  color: #ffffff;
  font: 700 13px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}

button[class*="toggle"]:has([data-slot="sidebar.brand.mark"]):hover::before {
  display: none;
}

div[class*="headline"]:has(> span[class*="headlineText"], > span[class*="previewBadge"]) {
  display: none !important;
}
`

const DSH_BRAND_CSS_EVENTS = [
  'dom-ready',
  'did-finish-load',
  'did-navigate',
  'did-navigate-in-page',
] as const

const DSH_BRAND_STYLE_ID = 'robbot-dsh-brand-override'

type DshWebviewElement = HTMLElement & {
  executeJavaScript: (code: string) => Promise<unknown>;
}

function App() {
  const { t } = useTranslation()
  const windowKind = window.robbot.app.getWindowKind()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [booted, setBooted] = useState(windowKind === 'login')

  useEffect(() => {
    if (windowKind === 'login') {
      return
    }

    void window.robbot.auth.getCurrent().then(setUser).finally(() => setBooted(true))
  }, [windowKind])

  if (!booted) return <div className="grid h-full place-items-center text-sm text-slate-500">{t('common.loading')}</div>
  if (windowKind === 'login') return <LoginPage onDone={() => { window.robbot.app.showMainWindow() }} />
  if (!user) return <LoginRedirect />
  return <AuthenticatedApp user={user} />
}

function LoginRedirect() {
  const { t } = useTranslation()

  useEffect(() => {
    window.robbot.app.showLoginWindow()
  }, [])

  return <div className="grid h-full place-items-center text-sm text-slate-500">{t('common.loading')}</div>
}

function AuthenticatedApp({ user }: { user: AuthUser }) {
  const { t } = useTranslation()
  const [account, setAccount] = useState<AccountRecord | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState(0)
  const [dshTarget, setDshTarget] = useState<DshWebViewTarget | null>(null)
  const [viewNonce, setViewNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [visibleTooltip, setVisibleTooltip] = useState<'refresh' | 'logout' | null>(null)
  const [pluginDiagnostics, setPluginDiagnostics] = useState<RuntimePluginDiagnostic[] | null>(null)
  const webviewRef = useRef<DshWebviewElement | null>(null)
  const desktopUpdate = useDesktopUpdateCheck(Boolean(user.id))

  useEffect(() => {
    void window.robbot.account.getCurrent().then(setAccount)
  }, [user.id])

  const loadDsh = async () => {
    setDshTarget(null)
    setViewNonce((value) => value + 1)
    setLoading(true)
    setError('')
    setPluginDiagnostics(null)
    try {
      const pluginPlan = await window.robbot.harness.resolveRuntimePlugins()
      if (!pluginPlan.ok) {
        setPluginDiagnostics(pluginPlan.diagnostics)
        setDshTarget(null)
        return
      }
      const target = await window.robbot.harness.getCurrentWebUrl()
      setDshTarget(target)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setDshTarget(null)
      setError(message)
      if (/API key is missing/i.test(message)) {
        setSettingsInitialTab(0)
        setSettingsOpen(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    if (!window.confirm(t('app.confirmSignOut'))) return
    await window.robbot.app.logoutAndShowLoginWindow()
  }

  const reloadDsh = async () => {
    if (!window.confirm(t('app.confirmReloadDsh'))) return
    await loadDsh()
  }

  const openSettings = (initialTab = 0) => {
    setSettingsInitialTab(initialTab)
    setSettingsOpen(true)
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const pluginPlan = await window.robbot.harness.resolveRuntimePlugins()
        if (!pluginPlan.ok) {
          if (!cancelled) {
            setPluginDiagnostics(pluginPlan.diagnostics)
            setDshTarget(null)
          }
          return
        }

        const target = await window.robbot.harness.getCurrentWebUrl()
        if (!cancelled) setDshTarget(target)
      } catch (cause) {
        if (cancelled) return
        const message = cause instanceof Error ? cause.message : String(cause)
        setDshTarget(null)
        setError(message)
        if (/API key is missing/i.test(message)) {
          setSettingsInitialTab(0)
          setSettingsOpen(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user.id])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null || dshTarget === null || settingsOpen) return

    const injectBrandCss = () => {
      const script = `
        (() => {
          const styleId = ${JSON.stringify(DSH_BRAND_STYLE_ID)};
          const css = ${JSON.stringify(DSH_BRAND_CSS)};
          let style = document.getElementById(styleId);
          if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
          }
          if (style.textContent !== css) {
            style.textContent = css;
          }
        })();
      `
      try {
        void webview.executeJavaScript(script).catch((cause) => {
          console.warn('Failed to apply DSH brand override:', cause)
        })
      } catch (cause) {
        console.warn('Failed to apply DSH brand override:', cause)
      }
    }

    injectBrandCss()
    const retryTimers = [150, 500, 1200].map((delay) => window.setTimeout(injectBrandCss, delay))
    DSH_BRAND_CSS_EVENTS.forEach((eventName) => {
      webview.addEventListener(eventName, injectBrandCss)
    })
    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer))
      DSH_BRAND_CSS_EVENTS.forEach((eventName) => {
        webview.removeEventListener(eventName, injectBrandCss)
      })
    }
  }, [dshTarget, settingsOpen, viewNonce])

  const saveSettings = async (field: 'deepseek' | 'openai', value: Record<string, unknown>) => {
    setDshTarget(null)
    setViewNonce((nonce) => nonce + 1)
    setAccount(await window.robbot.account.saveAndSelectAi(field, value))
    setSettingsOpen(false)
    await loadDsh()
  }

  const selectAi = async (field: 'deepseek' | 'openai') => {
    setDshTarget(null)
    setViewNonce((nonce) => nonce + 1)
    setAccount(await window.robbot.account.selectAi(field))
    await window.robbot.account.resetHarness()
    setSettingsOpen(false)
    await loadDsh()
  }

  const applyPluginResolution = async (owners: Record<string, string>) => {
    setLoading(true)
    setError('')
    try {
      const result = await window.robbot.harness.applyRuntimePluginResolution({ owners })
      if (!result.ok) {
        setPluginDiagnostics(result.diagnostics)
        return
      }
      setPluginDiagnostics(null)
      await loadDsh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="grid h-full min-h-0 grid-rows-[36px_minmax(0,1fr)] overflow-hidden bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {/* <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-950 text-[11px] font-semibold text-white">R</div> */}
          <div className="truncate bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-500 bg-clip-text text-[13px] font-semibold text-transparent">{t('app.title')}</div>
          {loading ? <div className="status-pulse text-[12px] text-slate-400">{t('app.startingDsh')}</div> : null}
        </div>
        <div className="flex items-center gap-0.5">
          <button className="group flex h-7 cursor-pointer items-center gap-1 rounded-md bg-indigo-50 px-2 text-[12px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-800" title={t('app.runtimePlugins')} onClick={() => openSettings(1)}>
            <Plug className="plugin-button-icon h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
            <span>{t('app.pluginsButton')}</span>
          </button>
          <button className="cursor-pointer relative flex h-7 items-center gap-x-0.5 rounded-md px-1.5 text-[12px] text-slate-500 hover:bg-slate-100" title={t('app.settings')} onClick={() => openSettings(0)}>
            <Settings className="h-3.5 w-3.5" />
            <span>{t('app.settings')}</span>
            {desktopUpdate.hasUpdate ? (
              <span className="absolute right-0 top-1 h-2 w-2 rounded-full bg-rose-500" />
            ) : null}
          </button>
          <span
            className="relative inline-flex"
            onMouseEnter={() => setVisibleTooltip('refresh')}
            onMouseLeave={() => setVisibleTooltip(null)}
          >
            <button
              className="flex h-7 cursor-pointer items-center rounded-md px-1.5 text-[12px] text-slate-500 hover:bg-slate-100"
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              onClick={() => {
                setVisibleTooltip(null)
                void reloadDsh()
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <span className={`pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white shadow-sm transition-opacity ${visibleTooltip === 'refresh' ? 'opacity-100' : 'opacity-0'}`}>
              {t('common.refresh')}
            </span>
          </span>
          <span
            className="relative inline-flex"
            onMouseEnter={() => setVisibleTooltip('logout')}
            onMouseLeave={() => setVisibleTooltip(null)}
          >
            <button
              className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-slate-500 hover:bg-slate-100"
              title={t('app.signOut')}
              aria-label={t('app.signOut')}
              onClick={() => {
                setVisibleTooltip(null)
                void logout()
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <span className={`pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white shadow-sm transition-opacity ${visibleTooltip === 'logout' ? 'opacity-100' : 'opacity-0'}`}>
              {t('app.signOut')}
            </span>
          </span>
        </div>
      </header>
      <section className="relative min-h-0 bg-[#f7f8fa]">
        {pluginDiagnostics ? (
          <PluginConflictResolver
            diagnostics={pluginDiagnostics}
            busy={loading}
            onApply={(owners) => { void applyPluginResolution(owners) }}
            onCancel={() => setPluginDiagnostics(null)}
          />
        ) : dshTarget ? (
          <webview
            ref={(node) => {
              webviewRef.current = node as DshWebviewElement | null
              node?.setAttribute('allowpopups', 'true')
            }}
            key={`${dshTarget.partition}:${dshTarget.fingerprint}:${viewNonce}`}
            title="DSH Desktop"
            src={dshTarget.url}
            partition={dshTarget.partition}
            className="h-full w-full border-0 bg-white"
            webpreferences="contextIsolation=yes,nodeIntegration=no"
          />
        ) : loading ? (
          <DshLoading />
        ) : (
          <div className="grid h-full place-items-center p-6">
            <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              <div className="font-medium text-slate-950">{t('app.dshNotReady')}</div>
              {error ? <pre className="mt-3 whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-sans text-[13px] text-rose-700">{error}</pre> : null}
              <div className="mt-4 flex gap-2">
                <button className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white" onClick={() => void loadDsh()}>{t('common.retry')}</button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={() => openSettings()}>{t('app.settings')}</button>
              </div>
            </div>
          </div>
        )}
        {settingsOpen ? (
          <div className="absolute inset-0 z-10">
            <SettingsModal
              key="settings-page"
              open
              variant="page"
              initialTab={settingsInitialTab}
              email={account?.email ?? user.email ?? ''}
              deepseek={account?.deepseek ?? null}
              openai={account?.openai ?? null}
              selectedAi={account?.selectedAi ?? null}
              appVersion={desktopUpdate.appVersion}
              updateCheck={desktopUpdate.updateCheck}
              onCheckUpdate={desktopUpdate.checkUpdate}
              onClose={() => setSettingsOpen(false)}
              onSave={saveSettings}
              onSelect={selectAi}
              onRuntimePluginsChanged={loadDsh}
              onLogout={() => { setSettingsOpen(false); void logout() }}
            />
          </div>
        ) : null}
      </section>
    </main>
  )
}

function DshLoading() {
  const { t } = useTranslation()

  return (
    <div className="grid h-full place-items-center bg-[#f7f8fa] p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="dsh-spinner" aria-hidden="true" />
        <div>
          <div className="text-[15px] font-medium text-slate-900">{t('app.dshLoading.title')}</div>
          <div className="mt-1 text-[13px] text-slate-500">{t('app.dshLoading.description')}</div>
        </div>
      </div>
    </div>
  )
}

function PluginConflictResolver(props: {
  diagnostics: RuntimePluginDiagnostic[];
  busy: boolean;
  onApply: (owners: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation()
  const conflicts = props.diagnostics.filter(isSingleSlotConflict)
  const [selectedOwners, setSelectedOwners] = useState<Record<string, string>>({})
  const owners = Object.fromEntries(conflicts.map((conflict) => {
    const selectedOwner = selectedOwners[conflict.slot]
    const owner = conflict.plugins.some((plugin) => plugin.name === selectedOwner)
      ? selectedOwner
      : conflict.plugins[0]?.name ?? ''
    return [conflict.slot, owner]
  }))

  if (conflicts.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-lg rounded-lg border border-rose-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="font-medium text-slate-950">{t('app.pluginConflict.invalidTitle')}</div>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-sans text-[13px] text-rose-700">
            {props.diagnostics.map((diagnostic) => formatPluginDiagnostic(diagnostic, t)).join('\n')}
          </pre>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={props.onCancel}>{t('common.cancel')}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <div className="font-medium text-slate-950">{t('app.pluginConflict.title')}</div>
        <p className="mt-2 text-[13px] leading-5 text-slate-500">
          {t('app.pluginConflict.description')}
        </p>
        <div className="mt-4 space-y-4">
          {conflicts.map((conflict) => (
            <fieldset key={conflict.slot} className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-[12px] font-medium uppercase tracking-wide text-slate-500">{conflict.slot}</legend>
              <div className="mt-2 space-y-2">
                {conflict.plugins.map((plugin) => (
                  <label key={plugin.name} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                    <input
                      type="radio"
                      name={`runtime-plugin-owner-${conflict.slot}`}
                      checked={owners[conflict.slot] === plugin.name}
                      onChange={() => setSelectedOwners((value) => ({ ...value, [conflict.slot]: plugin.name }))}
                    />
                    <span className="text-[13px] text-slate-800">{plugin.displayName ?? plugin.name}</span>
                    {plugin.displayName ? <span className="text-[12px] text-slate-400">{plugin.name}</span> : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={props.onCancel}>{t('common.cancel')}</button>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            disabled={props.busy || conflicts.some((conflict) => !owners[conflict.slot])}
            onClick={() => props.onApply(owners)}
          >
            {t('app.pluginConflict.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

function isSingleSlotConflict(diagnostic: RuntimePluginDiagnostic): diagnostic is SingleSlotConflict {
  return diagnostic.type === 'single-slot-conflict'
}

function formatPluginDiagnostic(diagnostic: RuntimePluginDiagnostic, t: ReturnType<typeof useTranslation>['t']): string {
  if (diagnostic.type === 'single-slot-conflict') {
    return t('diagnostics.singleSlotConflict', {
      slot: diagnostic.slot,
      owners: diagnostic.plugins.map((plugin) => plugin.displayName ?? plugin.name).join(', '),
    })
  }
  if (diagnostic.type === 'missing-plugin') {
    return t('diagnostics.missingPlugin', { plugin: diagnostic.plugin.displayName ?? diagnostic.plugin.name })
  }
  if (diagnostic.type === 'unknown-slot-registration') {
    return t('diagnostics.unknownSlotRegistration', {
      plugin: diagnostic.plugin.displayName ?? diagnostic.plugin.name,
      slot: diagnostic.slot,
    })
  }
  return t('diagnostics.runtimePluginDiagnostic')
}

export default App

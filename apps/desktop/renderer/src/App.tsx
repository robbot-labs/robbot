import { useEffect, useRef, useState } from 'react'
import { LogOut, Plug, RefreshCw, Settings } from 'lucide-react'
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

type DshWebviewElement = HTMLElement & {
  insertCSS: (css: string) => Promise<string>;
}

function App() {
  const windowKind = window.robbot.app.getWindowKind()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [booted, setBooted] = useState(windowKind === 'login')

  useEffect(() => {
    if (windowKind === 'login') {
      return
    }

    void window.robbot.auth.getCurrent().then(setUser).finally(() => setBooted(true))
  }, [windowKind])

  if (!booted) return <div className="grid h-full place-items-center text-sm text-slate-500">Loading...</div>
  if (windowKind === 'login') return <LoginPage onDone={() => { window.robbot.app.showMainWindow() }} />
  if (!user) return <LoginRedirect />
  return <AuthenticatedApp user={user} />
}

function LoginRedirect() {
  useEffect(() => {
    window.robbot.app.showLoginWindow()
  }, [])

  return <div className="grid h-full place-items-center text-sm text-slate-500">Loading...</div>
}

function AuthenticatedApp({ user }: { user: AuthUser }) {
  const [account, setAccount] = useState<AccountRecord | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState(0)
  const [dshTarget, setDshTarget] = useState<DshWebViewTarget | null>(null)
  const [viewNonce, setViewNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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
    if (!window.confirm('Are you sure you want to sign out?')) return
    await window.robbot.app.logoutAndShowLoginWindow()
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
      void webview.insertCSS(DSH_BRAND_CSS).catch((cause) => {
        console.warn('Failed to apply DSH brand override:', cause)
      })
    }

    webview.addEventListener('dom-ready', injectBrandCss)
    return () => {
      webview.removeEventListener('dom-ready', injectBrandCss)
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
    <main className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-950 text-[11px] font-semibold text-white">R</div> */}
          <div className="truncate text-[13px] font-medium text-slate-700">Robbot — Personal AI powered by DeepSeek Harness</div>
          {loading ? <div className="status-pulse text-[12px] text-slate-400">Starting DSH...</div> : null}
        </div>
        <div className="flex items-center gap-0.5">
          <button className="flex h-8 items-center rounded-md px-2 text-[13px] text-slate-500 hover:bg-slate-100" title="Runtime Plugins" onClick={() => openSettings(1)}>
            <Plug className="h-4 w-4" />
            <span>功能</span>
          </button>
          <button className="relative flex h-8 items-center gap-x-0.5 rounded-md px-2 text-[13px] text-slate-500 hover:bg-slate-100" title="Settings" onClick={() => openSettings(0)}>
            <Settings className="h-4 w-4" />
            <span>设置</span>
            {desktopUpdate.hasUpdate ? (
              <span className="absolute right-[2px] top-1.5 h-2 w-2 rounded-full bg-rose-500" />
            ) : null}
          </button>
          <button className="flex h-8 items-center rounded-md px-2 text-[13px] text-slate-500 hover:bg-slate-100" title="Reload DSH" onClick={() => void loadDsh()}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" title={account?.email ?? user.email ?? 'Sign out'} onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
          </button>
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
              <div className="font-medium text-slate-950">DSH Desktop is not ready</div>
              {error ? <pre className="mt-3 whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-sans text-[13px] text-rose-700">{error}</pre> : null}
              <div className="mt-4 flex gap-2">
                <button className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white" onClick={() => void loadDsh()}>Retry</button>
                <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={() => openSettings()}>Settings</button>
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
  return (
    <div className="grid h-full place-items-center bg-[#f7f8fa] p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="dsh-spinner" aria-hidden="true" />
        <div>
          <div className="text-[15px] font-medium text-slate-900">Starting DeepSeek Harness</div>
          <div className="mt-1 text-[13px] text-slate-500">Preparing your isolated runtime…</div>
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
          <div className="font-medium text-slate-950">Runtime plugin configuration is invalid</div>
          <pre className="mt-3 whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-sans text-[13px] text-rose-700">
            {props.diagnostics.map(formatPluginDiagnostic).join('\n')}
          </pre>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={props.onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <div className="font-medium text-slate-950">插件界面冲突</div>
        <p className="mt-2 text-[13px] leading-5 text-slate-500">
          以下插件都会接管 HARNESS 的 single slot。当前每个 slot 只能启用一个 owner，请选择当前使用的界面插件。
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
          <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={props.onCancel}>取消</button>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            disabled={props.busy || conflicts.some((conflict) => !owners[conflict.slot])}
            onClick={() => props.onApply(owners)}
          >
            应用并启动
          </button>
        </div>
      </div>
    </div>
  )
}

function isSingleSlotConflict(diagnostic: RuntimePluginDiagnostic): diagnostic is SingleSlotConflict {
  return diagnostic.type === 'single-slot-conflict'
}

function formatPluginDiagnostic(diagnostic: RuntimePluginDiagnostic): string {
  if (diagnostic.type === 'single-slot-conflict') {
    return `single slot "${diagnostic.slot}" has multiple owners: ${diagnostic.plugins.map((plugin) => plugin.displayName ?? plugin.name).join(', ')}`
  }
  if (diagnostic.type === 'missing-plugin') {
    return `enabled plugin is missing: ${diagnostic.plugin.displayName ?? diagnostic.plugin.name}`
  }
  if (diagnostic.type === 'unknown-slot-registration') {
    return `unknown slot registration in ${diagnostic.plugin.displayName ?? diagnostic.plugin.name}: ${diagnostic.slot}`
  }
  return 'Runtime plugin diagnostic'
}

export default App

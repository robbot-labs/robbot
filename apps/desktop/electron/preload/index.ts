import { contextBridge, ipcRenderer } from 'electron';

const windowKind = process.argv
  .find((arg) => arg.startsWith('--robbot-window-kind='))
  ?.split('=')[1] === 'main'
    ? 'main'
    : 'login';

contextBridge.exposeInMainWorld('robbot', {
  app: {
    getWindowKind: () => windowKind,
    showMainWindow: () => ipcRenderer.send('robbot:show-main-window'),
    showLoginWindow: () => ipcRenderer.send('robbot:show-login-window'),
    logoutAndShowLoginWindow: () => ipcRenderer.invoke('robbot:logout-and-show-login-window'),
    isPackaged: process.env.NODE_ENV !== 'development',
    platform: process.platform,
    arch: process.arch,
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    checkUpdate: (input: unknown) => ipcRenderer.invoke('app:check-update', input),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  },
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  auth: {
    getCurrent: () => ipcRenderer.invoke('auth:get-current'),
    getSavedLogin: () => ipcRenderer.invoke('auth:get-saved-login'),
    login: (input: unknown) => ipcRenderer.invoke('auth:login', input),
    register: (input: unknown) => ipcRenderer.invoke('auth:register', input),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  account: {
    getCurrent: () => ipcRenderer.invoke('account:get-current'),
    updateAiConfig: (field: 'deepseek' | 'openai', value: unknown) =>
      ipcRenderer.invoke('account:update-ai-config', field, value),
    saveAndSelectAi: (field: 'deepseek' | 'openai', value: unknown) =>
      ipcRenderer.invoke('account:save-and-select-ai', field, value),
    selectAi: (selectedAi: 'deepseek' | 'openai' | null) =>
      ipcRenderer.invoke('account:select-ai', selectedAi),
    resetHarness: () => ipcRenderer.invoke('account:reset-harness'),
  },
  workspace: {
    list: (accountId: string) => ipcRenderer.invoke('workspace:list', accountId),
    save: (input: unknown) => ipcRenderer.invoke('workspace:save', input),
    selectDirectory: (accountId: string) => ipcRenderer.invoke('workspace:select-directory', accountId),
    rename: (accountId: string, workspaceId: string, name: string) =>
      ipcRenderer.invoke('workspace:rename', accountId, workspaceId, name),
    delete: (accountId: string, workspaceId: string) => ipcRenderer.invoke('workspace:delete', accountId, workspaceId),
  },
  session: {
    list: (accountId: string, workspaceId?: string | null) => ipcRenderer.invoke('session:list', accountId, workspaceId),
    create: (input: unknown) => ipcRenderer.invoke('session:create', input),
    rename: (accountId: string, sessionId: string, title: string) =>
      ipcRenderer.invoke('session:rename', accountId, sessionId, title),
    archive: (accountId: string, sessionId: string) => ipcRenderer.invoke('session:archive', accountId, sessionId),
    delete: (accountId: string, sessionId: string) => ipcRenderer.invoke('session:delete', accountId, sessionId),
  },
  message: {
    list: (sessionId: string) => ipcRenderer.invoke('message:list', sessionId),
    listEvents: (sessionId: string) => ipcRenderer.invoke('session-events:list', sessionId),
  },
  harness: {
    getStatus: () => ipcRenderer.invoke('harness:get-status'),
    resolveRuntimePlugins: () => ipcRenderer.invoke('harness:resolve-runtime-plugins'),
    getRuntimePlugins: () => ipcRenderer.invoke('harness:get-runtime-plugins'),
    setRuntimePluginEnabled: (input: unknown) => ipcRenderer.invoke('harness:set-runtime-plugin-enabled', input),
    setRuntimePluginsEnabled: (input: unknown) => ipcRenderer.invoke('harness:set-runtime-plugins-enabled', input),
    applyRuntimePluginResolution: (input: unknown) => ipcRenderer.invoke('harness:apply-runtime-plugin-resolution', input),
    getCurrentWebUrl: () => ipcRenderer.invoke('harness:get-current-web-url'),
    listActiveRuns: () => ipcRenderer.invoke('harness:list-active-runs'),
    warmupRuntime: (input: unknown) => ipcRenderer.invoke('harness:warmup-runtime', input),
    runPrompt: (input: unknown) => ipcRenderer.invoke('harness:run-prompt', input),
    retryMessage: (messageId: string) => ipcRenderer.invoke('harness:retry-message', messageId),
    cancel: (sessionId: string) => ipcRenderer.invoke('harness:cancel', sessionId),
    approve: (sessionId: string, approvalId: string, approved: boolean) =>
      ipcRenderer.invoke('harness:approve', sessionId, approvalId, approved),
    onLog: (listener: (entry: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, entry: unknown) => listener(entry);
      ipcRenderer.on('harness:log', handler);

      return () => {
        ipcRenderer.off('harness:log', handler);
      };
    },
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, harnessEvent: unknown) => listener(harnessEvent);
      ipcRenderer.on('harness:event', handler);

      return () => {
        ipcRenderer.off('harness:event', handler);
      };
    },
  },
});

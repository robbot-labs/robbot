import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import path from 'node:path';

import type { RuntimeServices } from '../runtime';
import type { HarnessRunInput, HarnessWarmupInput } from '../main/harness/harness-service';
import type { AccountRecord } from '../storage/repositories';

export interface SaveWorkspaceInput {
  accountId: string;
  id?: string;
  name: string;
  rootPath: string;
  permissionPolicy?: unknown;
}

export interface CreateSessionInput {
  accountId: string;
  id?: string;
  workspaceId?: string | null;
  title?: string | null;
  activeSkillId?: string | null;
}

export function registerIpcHandlers(services: RuntimeServices): void {
  services.harness.setLogSink((entry) => {
    broadcast('harness:log', entry);
  });
  services.harness.setEventSink((event) => {
    broadcast('harness:event', event);
  });

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:check-update', (_event, input: { platform: string; arch: string; version: string; channel?: string }) =>
    services.auth.checkDesktopUpdate(input),
  );
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    const target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol)) {
      throw new Error('Only http(s) URLs can be opened.');
    }
    await shell.openExternal(target.toString());
  });

  ipcMain.handle('auth:get-current', () => services.auth.getCurrentUser());
  ipcMain.handle('auth:get-saved-login', () => services.auth.getSavedLogin());
  ipcMain.handle('auth:login', async (_event, input: { email: string; password: string }) => {
    const previous = services.auth.getCurrentUser();
    const next = await services.auth.login(input);
    if (previous && previous.id !== next.id) {
      await services.harness.resetForAccount(previous.id);
    }
    return next;
  });
  ipcMain.handle('auth:register', async (_event, input: { email: string; password: string }) => {
    const previous = services.auth.getCurrentUser();
    const next = await services.auth.register(input);
    if (previous && previous.id !== next.id) {
      await services.harness.resetForAccount(previous.id);
    }
    return next;
  });
  ipcMain.handle('auth:logout', async () => {
    const current = services.auth.getCurrentUser();
    services.auth.logout();
    if (current) {
      void services.harness.resetForAccount(current.id).catch((cause) => {
        console.warn('Failed to reset DSH runtime after logout:', cause);
      });
    }
  });

  ipcMain.handle('account:get-current', () => sanitizeAccount(services.auth.requireCurrentAccount()));
  ipcMain.handle('account:update-ai-config', (_event, field: 'deepseek' | 'openai', value: unknown) => {
    const account = services.auth.requireCurrentAccount();
    return sanitizeAccount(services.accounts.updateAiConfig(account.id, field, value));
  });
  ipcMain.handle('account:save-and-select-ai', async (_event, field: 'deepseek' | 'openai', value: unknown) => {
    const account = services.auth.requireCurrentAccount();
    services.accounts.updateAiConfig(account.id, field, value);
    const selected = services.accounts.selectAi(account.id, field);
    await services.harness.resetForAccount(account.id);
    return sanitizeAccount(selected);
  });
  ipcMain.handle('account:select-ai', (_event, selectedAi: 'deepseek' | 'openai' | null) => {
    const account = services.auth.requireCurrentAccount();
    return sanitizeAccount(services.accounts.selectAi(account.id, selectedAi));
  });
  ipcMain.handle('account:reset-harness', () => services.harness.resetForAccount(services.auth.requireCurrentUser().id));

  ipcMain.handle('workspace:list', (_event, accountId: string) => services.workspaces.list(requireCurrentAccountId(services, accountId)));
  ipcMain.handle('workspace:save', (_event, input: SaveWorkspaceInput) => services.workspaces.save({ ...input, accountId: requireCurrentAccountId(services, input.accountId) }));
  ipcMain.handle('workspace:select-directory', async (event, accountId: string) => {
    const currentAccountId = requireCurrentAccountId(services, accountId);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择内容目录',
      buttonLabel: '使用此目录',
      message: '选择用于保存和管理内容素材、草稿与发布文件的目录',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const rootPath = result.filePaths[0];
    return services.workspaces.save({
      accountId: currentAccountId,
      rootPath,
      name: path.basename(rootPath) || rootPath,
      permissionPolicy: {},
    });
  });
  ipcMain.handle('workspace:rename', (_event, accountId: string, workspaceId: string, name: string) =>
    services.workspaces.rename(requireCurrentAccountId(services, accountId), workspaceId, name),
  );
  ipcMain.handle('workspace:delete', (_event, accountId: string, workspaceId: string) =>
    services.workspaces.delete(requireCurrentAccountId(services, accountId), workspaceId),
  );

  ipcMain.handle('session:list', (_event, accountId: string, workspaceId?: string | null) =>
    services.sessions.list(requireCurrentAccountId(services, accountId), workspaceId),
  );
  ipcMain.handle('session:create', (_event, input: CreateSessionInput) => services.sessions.create({ ...input, accountId: requireCurrentAccountId(services, input.accountId) }));
  ipcMain.handle('session:rename', (_event, accountId: string, sessionId: string, title: string) =>
    services.sessions.rename(requireCurrentAccountId(services, accountId), sessionId, title),
  );
  ipcMain.handle('session:archive', (_event, accountId: string, sessionId: string) =>
    services.sessions.archive(requireCurrentAccountId(services, accountId), sessionId),
  );
  ipcMain.handle('session:delete', (_event, accountId: string, sessionId: string) =>
    services.sessions.delete(requireCurrentAccountId(services, accountId), sessionId),
  );

  ipcMain.handle('message:list', (_event, sessionId: string) => {
    requireSessionOwnedByCurrentAccount(services, sessionId);
    return services.messages.list(sessionId);
  });
  ipcMain.handle('session-events:list', (_event, sessionId: string) => {
    requireSessionOwnedByCurrentAccount(services, sessionId);
    return services.sessionEvents.list(sessionId);
  });

  ipcMain.handle('harness:get-status', () => services.harness.getStatus());
  ipcMain.handle('harness:get-current-web-url', () => services.harness.getWebUrlForAccount(services.auth.requireCurrentUser().id));
  ipcMain.handle('harness:list-active-runs', () => services.harness.getActiveRuns());
  ipcMain.handle('harness:warmup-runtime', (_event, input: HarnessWarmupInput) => services.harness.warmup({ ...input, accountId: requireCurrentAccountId(services, input.accountId) }));
  ipcMain.handle('harness:run-prompt', (_event, input: HarnessRunInput) => services.harness.runPrompt({ ...input, accountId: requireCurrentAccountId(services, input.accountId) }));
  ipcMain.handle('harness:retry-message', (_event, messageId: string) => services.harness.retryMessageForAccount(requireCurrentAccountId(services), messageId));
  ipcMain.handle('harness:cancel', (_event, sessionId: string) => {
    requireSessionOwnedByCurrentAccount(services, sessionId);
    return services.harness.cancel(sessionId);
  });
  ipcMain.handle('harness:approve', (_event, sessionId: string, approvalId: string, approved: boolean) =>
    {
      requireSessionOwnedByCurrentAccount(services, sessionId);
      return services.harness.approve(sessionId, { approvalId, approved });
    },
  );
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function sanitizeAccount(account: AccountRecord): Omit<AccountRecord, 'authToken' | 'authExp' | 'savedPassword' | 'savedPasswordUpdatedAt'> {
  const { authToken: _authToken, authExp: _authExp, savedPassword: _savedPassword, savedPasswordUpdatedAt: _savedPasswordUpdatedAt, ...safeAccount } = account;
  return safeAccount;
}

function requireCurrentAccountId(services: RuntimeServices, requestedAccountId?: string): string {
  const current = services.auth.requireCurrentUser().id;
  if (requestedAccountId !== undefined && requestedAccountId !== current) {
    throw new Error('Account mismatch.');
  }
  return current;
}

function requireSessionOwnedByCurrentAccount(services: RuntimeServices, sessionId: string): void {
  const current = requireCurrentAccountId(services);
  const session = services.sessions.getById(sessionId);
  if (session.accountId !== current) {
    throw new Error('Account mismatch.');
  }
}

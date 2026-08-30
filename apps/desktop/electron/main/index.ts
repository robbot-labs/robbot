import { app, BrowserWindow, ipcMain } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';

import { registerIpcHandlers } from '../ipc';
import { initializeRuntime } from '../runtime';
import { createAppTray, isAppQuitting, markAppQuitting } from './tray';
import { createLoginWindow, createMainWindow } from './window';

if (squirrelStartup) {
  app.quit();
}

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  const services = initializeRuntime();
  registerIpcHandlers(services);

  app.on('before-quit', () => {
    markAppQuitting();
    void services.dispose();
  });

  const showMainWindow = async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = await createMainWindow();
      mainWindow.on('close', (event) => {
        if (isAppQuitting()) return;

        event.preventDefault();
        mainWindow?.hide();
      });
      mainWindow.on('closed', () => { mainWindow = null; });
    }

    if (process.platform === 'darwin') {
      app.dock?.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  };

  const showLoginWindow = async () => {
    if (!loginWindow || loginWindow.isDestroyed()) {
      loginWindow = await createLoginWindow();
      loginWindow.on('closed', () => { loginWindow = null; });
    }

    if (loginWindow.isMinimized()) {
      loginWindow.restore();
    }
    loginWindow.show();
    loginWindow.focus();
  };

  const showStartupWindow = async () => {
    if (services.auth.getCurrentUser()) {
      await showMainWindow();
      return;
    }

    await showLoginWindow();
  };

  createAppTray({ onShowWindow: showStartupWindow });

  await showStartupWindow();

  ipcMain.on('robbot:show-main-window', async (event) => {
    if (event.sender !== loginWindow?.webContents) return;
    const oldLoginWindow = loginWindow;
    await showMainWindow();
    oldLoginWindow?.close();
    loginWindow = null;
  });

  ipcMain.on('robbot:show-login-window', async (event) => {
    if (event.sender !== mainWindow?.webContents) return;

    const oldMainWindow = mainWindow;
    oldMainWindow.hide();
    mainWindow = null;
    await showLoginWindow();
    oldMainWindow.destroy();
  });

  ipcMain.handle('robbot:logout-and-show-login-window', async (event) => {
    if (event.sender !== mainWindow?.webContents) return;

    const oldMainWindow = mainWindow;
    oldMainWindow.hide();
    mainWindow = null;

    const current = services.auth.getCurrentUser();
    services.auth.logout();
    if (current) {
      await services.harness.resetForAccount(current.id).catch((cause) => {
        console.warn('Failed to reset DSH runtime after logout:', cause);
      });
    }

    await showLoginWindow();
    oldMainWindow.destroy();
  });

  app.on('activate', async () => {
    await showStartupWindow();
  });
}

app.whenReady().then(bootstrap).catch((error: unknown) => {
  console.error('Failed to bootstrap Electron app:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

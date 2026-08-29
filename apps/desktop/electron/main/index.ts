import { app, BrowserWindow, ipcMain } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';

import { registerIpcHandlers } from '../ipc';
import { initializeRuntime } from '../runtime';
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
    void services.dispose();
  });

  const showStartupWindow = async () => {
    if (services.auth.getCurrentUser()) {
      mainWindow = await createMainWindow();
      mainWindow.on('closed', () => { mainWindow = null; });
      return;
    }

    loginWindow = await createLoginWindow();
    loginWindow.on('closed', () => { loginWindow = null; });
  };

  await showStartupWindow();

  ipcMain.on('robbot:show-main-window', async (event) => {
    if (event.sender !== loginWindow?.webContents) return;
    const oldLoginWindow = loginWindow;
    mainWindow = await createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });
    oldLoginWindow?.close();
    loginWindow = null;
  });

  ipcMain.on('robbot:show-login-window', async (event) => {
    if (event.sender !== mainWindow?.webContents) return;

    const oldMainWindow = mainWindow;
    oldMainWindow.hide();
    mainWindow = null;
    loginWindow = await createLoginWindow();
    loginWindow.on('closed', () => { loginWindow = null; });
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

    loginWindow = await createLoginWindow();
    loginWindow.on('closed', () => { loginWindow = null; });
    oldMainWindow.destroy();
  });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await showStartupWindow();
    }
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

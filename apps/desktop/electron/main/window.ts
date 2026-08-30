import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const rendererDevUrl = process.env.ROBBOT_RENDERER_DEV_URL;
const isDevelopment = process.env.NODE_ENV === 'development' || Boolean(rendererDevUrl);

// 生产模式用的。Vite renderer 构建后产物
function getPreloadPath(): string {
  return path.join(app.getAppPath(), 'dist-electron/preload/index.js');
}

// 生产模式用的。Vite renderer 构建后产物
function getRendererHtmlPath(): string {
  return path.join(app.getAppPath(), 'renderer/dist/index.html');
}

export function getAppIconPath(): string {
  return path.join(app.getAppPath(), 'assets/icon.png');
}

export function getTrayIconPath(): string {
  if (process.platform === 'win32') {
    return path.join(app.getAppPath(), 'assets/icon.ico');
  }

  return getAppIconPath();
}

export function getPreloadPathForWindow(): string {
  return getPreloadPath()
}

export type RobbotWindowKind = 'login' | 'main';

function getWindowArguments(kind: RobbotWindowKind): string[] {
  return [`--robbot-window-kind=${kind}`];
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const iconPath = getAppIconPath();

  if (process.platform === 'darwin') {
    app.dock?.setIcon(iconPath);
  }

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 12 } : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: getPreloadPath(),
      additionalArguments: getWindowArguments('main'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (process.platform !== 'darwin') {
    win.setMenu(null);
    win.setMenuBarVisibility(false);
  }

  if (rendererDevUrl) {
    await win.loadURL(rendererDevUrl);
  } else {
    await win.loadFile(getRendererHtmlPath());
  }

  if (isDevelopment) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

export async function createLoginWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    show: false,
    icon: getAppIconPath(),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: getPreloadPath(),
      additionalArguments: getWindowArguments('login'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  if (process.platform !== 'darwin') {
    win.setMenu(null);
    win.setMenuBarVisibility(false);
  }

  if (rendererDevUrl) await win.loadURL(rendererDevUrl);
  else await win.loadFile(getRendererHtmlPath());
  win.show();
  return win;
}

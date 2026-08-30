import { app, Menu, nativeImage, Tray } from 'electron';

import { getTrayIconPath } from './window';

let appTray: Tray | null = null;
let isQuitting = false;

export function markAppQuitting(): void {
  isQuitting = true;
}

export function isAppQuitting(): boolean {
  return isQuitting;
}

export function quitFromTray(): void {
  markAppQuitting();
  app.quit();
}

export function createAppTray(options: { onShowWindow: () => void | Promise<void> }): Tray {
  if (appTray) {
    return appTray;
  }

  const icon = nativeImage.createFromPath(getTrayIconPath());
  const trayIcon = process.platform === 'darwin'
    ? icon.resize({ width: 16, height: 16 })
    : icon;

  const showWindow = () => {
    void Promise.resolve(options.onShowWindow()).catch((cause) => {
      console.warn('Failed to show Robbot window from tray:', cause);
    });
  };

  appTray = new Tray(trayIcon);
  appTray.setToolTip('Robbot');
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Robbot', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: quitFromTray },
  ]));
  appTray.on('click', showWindow);

  return appTray;
}

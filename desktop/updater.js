'use strict';

const { app, Notification } = require('electron');

function setupAutoUpdater({ getMainWindow, log = () => {} } = {}) {
  const noop = { checkNow: async () => false, isReady: () => false, installNow: () => false };

  if (!app.isPackaged) {
    log('[updater] Ignorado em modo de desenvolvimento.');
    return noop;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (error) {
    log('[updater] electron-updater indisponível:', error?.message || error);
    return noop;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  let updateReady = false;
  let downloadedVersion = null;

  const notify = (title, body) => {
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    } catch {}
  };

  autoUpdater.on('checking-for-update', () => log('[updater] Procurando atualização...'));
  autoUpdater.on('update-available', (info) => {
    log('[updater] Atualização disponível:', info?.version || 'desconhecida');
    notify('Atualização do Azurecord', `Baixando a versão ${info?.version || 'mais recente'} em segundo plano.`);
  });
  autoUpdater.on('update-not-available', (info) => log('[updater] Já está atualizado:', info?.version || app.getVersion()));
  autoUpdater.on('download-progress', (progress) => {
    log('[updater] Download:', `${Math.round(Number(progress?.percent || 0))}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    downloadedVersion = info?.version || null;
    log('[updater] Atualização baixada:', downloadedVersion || 'desconhecida');
    notify('Atualização pronta', 'Feche a janela do Azurecord para reiniciar e instalar a nova versão.');
    try {
      const win = getMainWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('desktop:update-status', {
          state: 'downloaded',
          version: info?.version || null,
          installOnQuit: true,
        });
      }
    } catch {}
  });
  autoUpdater.on('error', (error) => log('[updater] Erro:', error?.stack || error));

  const checkNow = async () => {
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      log('[updater] Falha ao verificar:', error?.stack || error);
      return false;
    }
  };

  const isReady = () => updateReady;

  const installNow = () => {
    if (!updateReady) return false;
    try {
      log('[updater] Instalando atualização:', downloadedVersion || 'desconhecida');
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return true;
    } catch (error) {
      log('[updater] Falha ao instalar atualização:', error?.stack || error);
      return false;
    }
  };

  const startupTimer = setTimeout(checkNow, 8000);
  startupTimer.unref?.();
  const interval = setInterval(checkNow, 15 * 60 * 1000);
  interval.unref?.();

  return { checkNow, isReady, installNow };
}

module.exports = { setupAutoUpdater };

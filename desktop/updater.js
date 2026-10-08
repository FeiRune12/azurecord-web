'use strict';

const { app, Notification, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function setupAutoUpdater({ getMainWindow, log = () => {} } = {}) {
  const noop = { checkNow: async () => false, isReady: () => false, readyVersion: () => null, installNow: () => false };

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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  let updateReady = false;
  let downloadedVersion = null;
  let checkingPromise = null;
  let downloading = false;
  let installAfterDownload = false;
  let prompting = false;
  let offeredVersion = null;
  const stateFile = path.join(app.getPath('userData'), 'azurecord-update-state.json');

  const readState = () => {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
    catch { return {}; }
  };
  const writeState = (state) => {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
    } catch {}
  };
  const clearState = () => { try { fs.rmSync(stateFile, { force: true }); } catch {} };
  const startupState = readState();

  const notify = (title, body) => {
    try {
      if (Notification.isSupported()) new Notification({ title, body }).show();
    } catch {}
  };

  autoUpdater.on('checking-for-update', () => log('[updater] Procurando atualização...'));
  autoUpdater.on('update-available', async (info) => {
    const version = String(info?.version || 'mais recente');
    log('[updater] Atualização disponível:', version);
    if (prompting || downloading || updateReady || offeredVersion === version) return;
    prompting = true;
    offeredVersion = version;
    try {
      const win = getMainWindow?.();
      const options = {
        type: 'info',
        title: 'Atualização do Azurecord',
        message: `Azurecord ${version} está disponível.`,
        detail: 'Deseja atualizar agora? O Azurecord baixará a atualização e reiniciará para instalar. Se escolher Depois, continuará usando a versão atual.',
        buttons: ['Atualizar agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      };
      const result = win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
      if (result.response !== 0) {
        log('[updater] Atualização adiada:', version);
        return;
      }
      installAfterDownload = true;
      downloading = true;
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        downloading = false;
        installAfterDownload = false;
        offeredVersion = null;
        log('[updater] Falha no download:', error?.stack || error);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Azurecord',
          message: 'Não foi possível baixar a atualização.',
          detail: 'Verifique sua conexão e tente novamente em Ajuda > Buscar atualizações.',
          buttons: ['OK']
        });
      }
    } catch (error) {
      offeredVersion = null;
      log('[updater] Falha ao mostrar pergunta:', error?.stack || error);
    } finally {
      prompting = false;
    }
  });
  autoUpdater.on('update-not-available', (info) => log('[updater] Já está atualizado:', info?.version || app.getVersion()));
  autoUpdater.on('download-progress', (progress) => {
    log('[updater] Download:', `${Math.round(Number(progress?.percent || 0))}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    downloading = false;
    updateReady = true;
    downloadedVersion = info?.version || null;
    log('[updater] Atualização baixada:', downloadedVersion || 'desconhecida');
    writeState({ pendingVersion: downloadedVersion || null, downloadedAt: Date.now() });
    if (installAfterDownload) {
      installAfterDownload = false;
      installNow();
      return;
    }
    notify('Atualização pronta', 'A atualização está pronta para instalar.');
    try {
      const win = getMainWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send('desktop:update-status', {
          state: 'downloaded',
          version: info?.version || null,
          installOnQuit: false,
          autoInstall: false,
        });
      }
    } catch {}
  });
  autoUpdater.on('error', (error) => {
    downloading = false;
    installAfterDownload = false;
    log('[updater] Erro:', error?.stack || error);
  });

  const checkNow = async (manual = true) => {
    if (checkingPromise) return checkingPromise;
    if (updateReady) return { checked: true, available: true, ready: true, version: downloadedVersion };
    if (downloading || prompting) return { checked: true, available: true, ready: false, version: offeredVersion || null, busy: true };
    if (manual) offeredVersion = null;
    checkingPromise = (async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        const version = String(result?.updateInfo?.version || '').trim() || null;
        const available = !!version && version !== app.getVersion();
        return { checked: true, available, ready: updateReady, version, currentVersion: app.getVersion() };
      } catch (error) {
        log('[updater] Falha ao verificar:', error?.stack || error);
        return { checked: false, available: false, ready: updateReady, version: downloadedVersion, error: String(error?.message || error) };
      } finally {
        checkingPromise = null;
      }
    })();
    return checkingPromise;
  };

  const isReady = () => updateReady;
  const readyVersion = () => downloadedVersion;

  const installNow = () => {
    if (!updateReady) return false;
    try {
      log('[updater] Instalando atualização:', downloadedVersion || 'desconhecida');
      app.isQuitting = true;
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return true;
    } catch (error) {
      log('[updater] Falha ao instalar atualização:', error?.stack || error);
      return false;
    }
  };

  if (startupState?.pendingVersion && startupState.pendingVersion === app.getVersion()) {
    clearState();
    const completedTimer = setTimeout(() => {
      notify('Azurecord atualizado', `A versão ${app.getVersion()} foi instalada com sucesso.`);
      try {
        const win = getMainWindow?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send('desktop:update-status', { state: 'updated', version: app.getVersion() });
        }
      } catch {}
    }, 1800);
    completedTimer.unref?.();
  } else if (startupState?.pendingVersion && startupState.pendingVersion !== app.getVersion()) {
    log('[updater] Atualização pendente ainda não aplicada:', startupState.pendingVersion);
  }

  const startupTimer = setTimeout(() => checkNow(false), 1500);
  startupTimer.unref?.();
  const interval = setInterval(() => checkNow(false), 15 * 60 * 1000);
  interval.unref?.();

  return { checkNow, isReady, readyVersion, installNow };
}

module.exports = { setupAutoUpdater };

'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, Notification, shell, safeStorage, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupAutoUpdater } = require('./updater');

// Allow only one Azurecord process/window. If the launcher is run twice,
// the second launch forwards activation to the existing window and exits.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// Safe startup: avoid GPU-driver initialization issues on older/unstable systems.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-http-cache');

const LOG_FILE = path.join(app.getPath('temp'), 'azurecord-startup.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
  console.error(...args);
}
process.on('uncaughtException', (err) => log('[uncaughtException]', err?.stack || err));
process.on('unhandledRejection', (err) => log('[unhandledRejection]', err?.stack || err));

let mainWindow = null;
let tray = null;
let backend = null;
let backendAddress = null;
let updaterController = null;
const CLOUD_SESSION_FILE = () => path.join(app.getPath('userData'), 'cloud-session.bin');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#090b10',
    show: false,
    autoHideMenuBar: true,
    title: 'Azurecord',
    icon: path.join(__dirname, 'azurecord.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('[renderer-gone]', JSON.stringify(details));
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log(`[renderer-console:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log('[did-fail-load]', errorCode, errorDescription, validatedURL);
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });

  const rendererEntry = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.webContents.session.clearCache()
    .catch((err) => log('[renderer-cache-clear]', err?.message || err))
    .finally(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadFile(rendererEntry, { query: { build: app.getVersion() } })
        .catch((err) => log('[loadFile]', err?.stack || err));
    });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting && updaterController?.isReady?.()) {
      event.preventDefault();
      app.isQuitting = true;
      log('[updater] Fechando para instalar atualização pronta.');
      updaterController.installNow?.();
      return;
    }
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      try {
        tray?.displayBalloon({ title: 'Azurecord', content: 'O Azurecord continua aberto na bandeja.' });
      } catch {}
    }
  });
}

function buildMenu() {
  try {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Azurecord',
        submenu: [
          { label: 'Mostrar janela', click: () => mainWindow?.show() },
          { type: 'separator' },
          { label: 'Sair do Azurecord', click: () => { if (updaterController?.isReady?.()) updaterController.installNow?.(); else { app.isQuitting = true; app.quit(); } } }
        ]
      },
      {
        label: 'Janela',
        submenu: [
          { role: 'minimize' },
          { role: 'togglefullscreen', label: 'Tela cheia' },
          { type: 'separator' },
          { label: 'Recarregar interface', click: () => mainWindow?.webContents.reload() }
        ]
      },
      {
        label: 'Ajuda',
        submenu: [
          { label: 'Abrir pasta de dados', click: () => shell.openPath(app.getPath('userData')) },
          { label: 'Buscar atualizações', click: () => updaterController?.checkNow?.() },
          { label: 'Ferramentas de desenvolvedor', click: () => mainWindow?.webContents.openDevTools() }
        ]
      }
    ]);
    Menu.setApplicationMenu(menu);
  } catch (err) {
    log('[menu]', err?.stack || err);
  }
}

function setupTray() {
  try {
    const iconPath = path.join(__dirname, 'renderer', 'assets', 'azurecord-mark.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) throw new Error('Ícone da bandeja inválido.');
    tray = new Tray(image);
    tray.setToolTip('Azurecord');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Azurecord', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: 'separator' },
      { label: 'Sair', click: () => { if (updaterController?.isReady?.()) updaterController.installNow?.(); else { app.isQuitting = true; app.quit(); } } }
    ]));
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch (err) {
    tray = null;
    log('[tray-disabled]', err?.stack || err);
  }
}

async function startLocalBackend() {
  try {
    // A URL compartilhada precisa ser lida ANTES de decidir iniciar o banco local.
    // Antes, backend/.env era carregado só DEPOIS desta decisão e era ignorado.
    const readBackendUrl = (file) => {
      try {
        const line = fs.readFileSync(file,'utf8').split(/\r?\n/).find(l=>/^\s*AZURECORD_BACKEND_URL\s*=/.test(l));
        return line ? line.split('=').slice(1).join('=').trim().replace(/^(?:"([^"]*)"|'([^']*)')$/,(_m,d,s)=>d??s) : '';
      }catch{return '';}
    };
    const remote = String(process.env.AZURECORD_BACKEND_URL ||
      readBackendUrl(path.join(app.getPath('userData'),'backend','.env')) ||
      readBackendUrl(path.join(__dirname,'backend','.env')) || '').replace(/\/$/, '');
    if (remote) {
      if (!/^https:\/\//i.test(remote) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(remote)) throw new Error('O backend remoto deve usar HTTPS.');
      backendAddress = { address: 'remote', port: 0, baseUrl: remote };
      log('[backend-remote]', remote);
      return;
    }
    process.env.AZURECORD_USER_CONFIG_DIR = path.join(app.getPath('userData'), 'backend');
    const { startBackend } = require('./backend/server');
    const started = await startBackend({
      host: '127.0.0.1',
      port: 0,
      dataFile: path.join(app.getPath('userData'), 'backend', 'azurecord.json')
    });
    backend = started.backend;
    backendAddress = started.address;
    log('[backend]', `http://127.0.0.1:${backendAddress.port}`);
  } catch (error) {
    backend = null;
    backendAddress = null;
    log('[backend-failed]', error?.stack || error);
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  try {
    app.setAppUserModelId('com.azurecord.app');

    try {
      session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
          callback(sources[0] ? { video: sources[0] } : {});
        } catch (err) {
          log('[display-media]', err?.message || err);
          callback({});
        }
      }, { useSystemPicker: true });
    } catch (err) {
      log('[display-media-handler]', err?.message || err);
    }

    ipcMain.handle('desktop:backend-info', () => ({
      host: backendAddress?.address || '127.0.0.1',
      port: backendAddress?.port || 0,
      baseUrl: backendAddress ? (backendAddress.baseUrl || `http://127.0.0.1:${backendAddress.port}`) : null,
      available: Boolean(backendAddress)
    }));

    ipcMain.handle('desktop:notify', (_event, payload = {}) => {
      if (!Notification.isSupported()) return false;
      new Notification({ title: String(payload.title || 'Azurecord'), body: String(payload.body || '') }).show();
      return true;
    });

    ipcMain.handle('desktop:secure-session-get', () => {
      try {
        const file = CLOUD_SESSION_FILE();
        if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch (err) { log('[secure-session-get]', err?.message || err); return null; }
    });

    ipcMain.handle('desktop:secure-session-set', (_event, token) => {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        const value = String(token || '');
        if (!value) return false;
        fs.mkdirSync(path.dirname(CLOUD_SESSION_FILE()), { recursive: true });
        fs.writeFileSync(CLOUD_SESSION_FILE(), safeStorage.encryptString(value));
        return true;
      } catch (err) { log('[secure-session-set]', err?.message || err); return false; }
    });

    ipcMain.handle('desktop:secure-session-delete', () => {
      try { fs.rmSync(CLOUD_SESSION_FILE(), { force: true }); return true; }
      catch (err) { log('[secure-session-delete]', err?.message || err); return false; }
    });

    buildMenu();
    createWindow();
    setupTray();
    updaterController = setupAutoUpdater({ getMainWindow: () => mainWindow, log });

    // Window is already visible before the backend starts. Backend failure can never block startup.
    await startLocalBackend();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:backend-status', {
        available: Boolean(backendAddress),
        baseUrl: backendAddress ? (backendAddress.baseUrl || `http://127.0.0.1:${backendAddress.port}`) : null
      });
    }
  } catch (err) {
    log('[startup-failed]', err?.stack || err);
    // Last-resort attempt: always show a window even if a secondary subsystem failed.
    try {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    } catch (fallbackErr) {
      log('[fallback-window-failed]', fallbackErr?.stack || fallbackErr);
    }
  }

  app.on('activate', () => mainWindow?.show());
});

app.on('render-process-gone', (_event, details) => log('[app-renderer-gone]', JSON.stringify(details)));
app.on('child-process-gone', (_event, details) => log('[child-process-gone]', JSON.stringify(details)));
app.on('gpu-process-crashed', (_event, killed) => log('[gpu-process-crashed]', killed));
app.on('will-quit', () => { app.isQuitting = true; });
app.on('before-quit', () => { try { backend?.close(); } catch {} });
app.on('window-all-closed', () => {});

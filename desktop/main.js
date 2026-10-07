'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, Notification, shell, safeStorage, desktopCapturer, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupAutoUpdater } = require('./updater');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const RICH_PRESENCE_GAMES = [
  { id: 'gunvolt-ix-dual', name: 'Gunvolt Chronicles: Luminous Avenger iX 1+2 Dual Collection', match: /gunvolt|luminous.*avenger/i }
];

async function detectRichPresenceGame() {
  if (process.platform !== 'win32') return null;
  try {
    // ProcessName is enough for most games and does not depend on the game exposing a window title.
    // CIM also gives us the executable path/command line, which helps collections and launchers.
    const command = "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Select-Object Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress";
    const result = await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',command], { windowsHide:true, timeout:8000, maxBuffer:4194304 });
    const raw = String(result.stdout || '').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      const haystack = [row?.Name,row?.ExecutablePath,row?.CommandLine].filter(Boolean).join(' ');
      const game = RICH_PRESENCE_GAMES.find(item => item.match.test(haystack));
      if (!game) continue;
      const started = Date.parse(row?.CreationDate || '');
      log('[rich-presence-detect] detected', game.id, String(row?.Name || ''));
      return { type:'game', gameId:game.id, name:game.name, startedAt:Number.isFinite(started)?started:Date.now() };
    }
  } catch (err) { log('[rich-presence-detect]', err?.message || err); }
  return null;
}

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

// Hardware acceleration stays enabled by default because AzureCall video/screen sharing benefits heavily from GPU decode/compositing.
// Set AZURECORD_DISABLE_GPU=1 only as a troubleshooting fallback on problematic drivers.
if (process.env.AZURECORD_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
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
let selectedDisplaySourceId = null;
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
          { label: 'Sair do Azurecord', click: () => { app.isQuitting = true; app.quit(); } }
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
      { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } }
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

    // YouTube embed requires an HTTP Referer in desktop/WebView environments.
    // The renderer is loaded from file://, so Chromium would otherwise send no usable Referer and YouTube returns error 153.
    try {
      const youtubeEmbedFilter = {
        urls: [
          'https://www.youtube.com/embed/*',
          'https://www.youtube-nocookie.com/embed/*'
        ]
      };
      session.defaultSession.webRequest.onBeforeSendHeaders(youtubeEmbedFilter, (details, callback) => {
        const requestHeaders = { ...(details.requestHeaders || {}) };
        for (const key of Object.keys(requestHeaders)) {
          if (key.toLowerCase() === 'referer') delete requestHeaders[key];
        }
        requestHeaders.Referer = 'https://azurecord.vercel.app/';
        callback({ requestHeaders });
      });
    } catch (err) {
      log('[youtube-embed-referer]', err?.message || err);
    }

    try {
      session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 1, height: 1 },
            fetchWindowIcons: false
          });
          const selected = sources.find(source => source.id === selectedDisplaySourceId) ||
            sources.find(source => String(source.id).startsWith('screen:')) ||
            sources[0] || null;
          selectedDisplaySourceId = null;
          callback(selected ? { video: selected } : {});
        } catch (err) {
          selectedDisplaySourceId = null;
          log('[display-media]', err?.message || err);
          callback({});
        }
      });
    } catch (err) {
      log('[display-media-handler]', err?.message || err);
    }

    ipcMain.handle('desktop:display-sources', async () => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 384, height: 216 },
          fetchWindowIcons: false
        });
        return sources.slice(0, 30).map(source => ({
          id: source.id,
          name: source.name,
          displayId: source.display_id || '',
          type: String(source.id).startsWith('screen:') ? 'screen' : 'window',
          thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
          appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
        }));
      } catch (err) {
        log('[display-sources]', err?.message || err);
        return [];
      }
    });

    ipcMain.handle('desktop:display-source-select', async (_event, sourceId) => {
      const id = String(sourceId || '');
      if (!id) return false;
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
        if (!sources.some(source => source.id === id)) return false;
        selectedDisplaySourceId = id;
        return true;
      } catch (err) {
        log('[display-source-select]', err?.message || err);
        return false;
      }
    });

    ipcMain.handle('desktop:cloud-fetch', async (_event, payload = {}) => {
      const rawUrl = String(payload.url || '');
      let target;
      try { target = new URL(rawUrl); } catch { throw new Error('URL Cloud inválida.'); }
      const allowedHosts = new Set([
        'azurecord-api.giovannisilvaalves604.workers.dev',
        'azurecord-realtime.giovannisilvaalves604.workers.dev'
      ]);
      if (target.protocol !== 'https:' || !allowedHosts.has(target.hostname)) {
        throw new Error('Destino Cloud não autorizado.');
      }
      const method = String(payload.method || 'GET').toUpperCase();
      if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('Método Cloud inválido.');
      const headers = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
      const init = { method, headers };
      if (payload.body != null && method !== 'GET') init.body = String(payload.body);
      const response = await net.fetch(target.toString(), init);
      const body = await response.text();
      return { ok: response.ok, status: response.status, text: body };
    });

    ipcMain.handle('desktop:backend-info', () => ({
      host: backendAddress?.address || '127.0.0.1',
      port: backendAddress?.port || 0,
      baseUrl: backendAddress ? (backendAddress.baseUrl || `http://127.0.0.1:${backendAddress.port}`) : null,
      available: Boolean(backendAddress)
    }));

    ipcMain.handle('desktop:set-badge-count', (_event, count = 0) => {
      const value = Math.max(0, Math.floor(Number(count) || 0));
      try { app.setBadgeCount(value); } catch {}
      return value;
    });
    ipcMain.handle('desktop:rich-presence', async () => detectRichPresenceGame());

    ipcMain.handle('desktop:notify', (_event, payload = {}) => {
      if (!Notification.isSupported()) return false;
      new Notification({ title: String(payload.title || 'Azurecord'), body: String(payload.body || '') }).show();
      return true;
    });

    ipcMain.handle('desktop:update-install', () => {
      return updaterController?.installNow?.() || false;
    });
    ipcMain.handle('desktop:update-check', async () => {
      const checked = await updaterController?.checkNow?.();
      return { checked: checked !== false, ready: !!updaterController?.isReady?.(), version: updaterController?.readyVersion?.() || null };
    });
    ipcMain.handle('desktop:update-state', () => ({
      ready: !!updaterController?.isReady?.(),
      version: updaterController?.readyVersion?.() || null
    }));

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

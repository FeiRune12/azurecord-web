'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const ROOT = path.resolve(__dirname);
const LOG = path.join(os.tmpdir(), 'azurecord-launcher.log');
const ELECTRON_VERSION = '44.3.0';
const ELECTRON_ZIP = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
const ELECTRON_URL = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${ELECTRON_ZIP}`;

function writeLog(message) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${message}\n`, 'utf8'); } catch {}
}
function fail(message) {
  writeLog(`ERROR ${message}`);
  try {
    const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${JSON.stringify(message)},'Azurecord')`;
    cp.spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command',ps], { windowsHide:true, stdio:'ignore' });
  } catch {}
  process.exit(1);
}

function findAppRoot(start) {
  const direct = path.join(start, 'package.json');
  const directMain = path.join(start, 'main.js');
  if (fs.existsSync(direct) && fs.existsSync(directMain)) return start;

  const queue = [{ dir:start, depth:0 }];
  const seen = new Set();
  while (queue.length) {
    const {dir, depth} = queue.shift();
    if (seen.has(dir) || depth > 3) continue;
    seen.add(dir);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (['node_modules','.git','backend-data'].includes(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child,'package.json')) && fs.existsSync(path.join(child,'main.js'))) return child;
      queue.push({dir:child, depth:depth+1});
    }
  }
  return null;
}

function findOnPath(name) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(';').filter(Boolean)) {
    const p = path.join(dir.replace(/^"|"$/g,''), name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function localElectron(appRoot) {
  const candidates = [
    path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(appRoot, 'node_modules', '.bin', 'electron.cmd')
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function findNpm() {
  const candidates = [
    process.env.npm_execpath,
    process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'nodejs', 'npm.cmd'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs', 'npm.cmd'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'npm.cmd'),
    findOnPath('npm.cmd'),
    findOnPath('npm.exe')
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

function installWithNpm(runtimeRoot) {
  const npm = findNpm();
  if (!npm) {
    writeLog('npm not found in common locations or PATH.');
    return false;
  }
  const packageJson = path.join(runtimeRoot, 'package.json');
  fs.mkdirSync(runtimeRoot, {recursive:true});
  fs.writeFileSync(packageJson, JSON.stringify({private:true}, null, 2));
  writeLog(`Trying npm installer: ${npm}`);
  const result = cp.spawnSync(npm, ['install', '--no-audit', '--no-fund', '--prefer-online', '--save-exact', `electron@${ELECTRON_VERSION}`], {
    cwd: runtimeRoot,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 300000
  });
  if (result.stdout) writeLog(`[npm stdout]\n${result.stdout.slice(-12000)}`);
  if (result.stderr) writeLog(`[npm stderr]\n${result.stderr.slice(-12000)}`);
  return result.status === 0;
}

function installWithPowerShell(runtimeRoot) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'azurecord-electron-'));
  const zipPath = path.join(tempRoot, ELECTRON_ZIP);
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    `$url = '${ELECTRON_URL}'`,
    `$zip = '${zipPath.replace(/'/g,"''")}'`,
    `$dest = '${tempRoot.replace(/'/g,"''")}'`,
    '$ProgressPreference = "SilentlyContinue"',
    'Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip',
    'Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force'
  ].join('; ');

  writeLog(`Trying direct Electron download: ${ELECTRON_URL}`);
  const result = cp.spawnSync('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command',psScript], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 600000
  });
  if (result.stdout) writeLog(`[powershell stdout]\n${result.stdout.slice(-8000)}`);
  if (result.stderr) writeLog(`[powershell stderr]\n${result.stderr.slice(-12000)}`);
  if (result.status !== 0) return false;

  // The archive contains electron.exe and runtime files at its root.
  const extractedRoot = tempRoot;
  const electronExe = path.join(extractedRoot, 'electron.exe');
  if (!fs.existsSync(electronExe)) return false;

  fs.mkdirSync(runtimeRoot, {recursive:true});
  // Copy the complete portable Electron runtime into the persistent cache.
  const entries = fs.readdirSync(extractedRoot, {withFileTypes:true});
  for (const entry of entries) {
    if (entry.name === ELECTRON_ZIP) continue;
    const src = path.join(extractedRoot, entry.name);
    const dst = path.join(runtimeRoot, entry.name);
    fs.cpSync(src, dst, {recursive:true, force:true});
  }
  return fs.existsSync(path.join(runtimeRoot, 'electron.exe'));
}

function ensureElectron(runtimeRoot) {
  const cached = path.join(runtimeRoot, 'electron.exe');
  if (fs.existsSync(cached)) return cached;

  fs.rmSync(runtimeRoot, {recursive:true, force:true});
  fs.mkdirSync(runtimeRoot, {recursive:true});

  if (installWithNpm(runtimeRoot)) {
    const npmElectron = path.join(runtimeRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (fs.existsSync(npmElectron)) return npmElectron;
  }

  fs.rmSync(runtimeRoot, {recursive:true, force:true});
  fs.mkdirSync(runtimeRoot, {recursive:true});
  if (installWithPowerShell(runtimeRoot)) return cached;

  fail(`Não foi possível instalar o Electron.\n\nO launcher tentou npm e também o download direto do runtime oficial.\n\nLog: ${LOG}`);
}

function main() {
  writeLog(`Launcher start. ROOT=${ROOT}`);
  const appRoot = findAppRoot(ROOT);
  if (!appRoot) fail(`Não encontrei o aplicativo Azurecord nesta pasta.\n\nPasta procurada: ${ROOT}`);

  let electron = localElectron(appRoot);
  if (!electron) {
    const runtimeRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'), 'Azurecord', `electron-${ELECTRON_VERSION}`);
    electron = ensureElectron(runtimeRoot);
  }
  if (!electron || !fs.existsSync(electron)) fail(`Electron não foi encontrado.\n\nLog: ${LOG}`);

  writeLog(`Launching Electron=${electron}`);
  writeLog(`AppRoot=${appRoot}`);
  const child = cp.spawn(electron, [appRoot, '--disable-gpu', '--disable-gpu-compositing'], {
    cwd: appRoot,
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child.unref();
  writeLog(`Electron PID=${child.pid}`);
}

main();

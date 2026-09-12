const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const GE_API_BASE = 'https://prices.runescape.wiki/api/v1/osrs';
// The wiki API blocks generic default User-Agents (curl, python-requests, ...)
// and asks for a descriptive one with contact info so they can reach out
// about misuse - see https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices
const GE_USER_AGENT = 'QuickTools decanting calculator - contact: kagenoikari@gmail.com';

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options.filters,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('fs:readFile', async (_event, filePath, encoding = 'utf-8') => {
  return fs.readFile(filePath, encoding);
});

ipcMain.handle('fs:writeFile', async (_event, filePath, data, encoding = 'utf-8') => {
  await fs.writeFile(filePath, data, encoding);
  return true;
});

ipcMain.handle('clipboard:writeText', (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});

// Item name/id metadata rarely changes, so it's fetched once per app run
// and reused - the wiki asks callers to avoid unnecessary repeat requests.
let geMappingCache = null;

ipcMain.handle('ge:mapping', async () => {
  if (geMappingCache) return geMappingCache;

  const res = await fetch(`${GE_API_BASE}/mapping`, {
    headers: { 'User-Agent': GE_USER_AGENT },
  });
  if (!res.ok) throw new Error(`GE mapping request failed: ${res.status}`);

  geMappingCache = await res.json();
  return geMappingCache;
});

ipcMain.handle('ge:latest', async () => {
  // Unparameterized /latest returns every item's price in one request,
  // which the wiki's usage policy prefers over looping the `id` param.
  const res = await fetch(`${GE_API_BASE}/latest`, {
    headers: { 'User-Agent': GE_USER_AGENT },
  });
  if (!res.ok) throw new Error(`GE latest request failed: ${res.status}`);

  const { data } = await res.json();
  return data;
});

ipcMain.handle('ge:volume1h', async () => {
  // Trailing-1h high/low trade counts per item - used as a liquidity signal
  // so slow-moving items can be flagged before someone buys into them.
  const res = await fetch(`${GE_API_BASE}/1h`, {
    headers: { 'User-Agent': GE_USER_AGENT },
  });
  if (!res.ok) throw new Error(`GE 1h request failed: ${res.status}`);

  const { data } = await res.json();
  return data;
});

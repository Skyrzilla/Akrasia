const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');

function createWindow() {
  const win = new BrowserWindow({ width: 1480, height: 920, minWidth: 1000, minHeight: 680, backgroundColor: '#050b16', title: 'Akrasia', icon: path.join(__dirname, 'assets', 'akrasia.ico'), frame: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile('index.html');
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const audioExtensions = new Set(['.mp3','.flac','.wav','.m4a','.mp4','.aac','.ogg','.opus','.wma','.aiff','.ape']);
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('scan-folder', async (_, root) => {
  const songs = [], warnings = [];
  const addWarning = message => { if (warnings.length < 10) warnings.push(message); };
  let metadataReader = null, metadataUnavailable = false;
  try { metadataReader = await import('music-metadata'); }
  catch { metadataUnavailable = true; }
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { addWarning('Some folders could not be read. Check their Windows permissions.'); return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())) {
        try {
          const stat = await fs.stat(file);
          let metadata = { common: {}, format: {} };
          if (metadataReader) { try { metadata = await metadataReader.parseFile(file, { skipCovers: false }); } catch { } }
          const c = metadata.common || {};
          const cover = c.picture?.[0];
          let coverMime = String(cover?.format || '').toLowerCase();
          if (coverMime === 'image/jpg' || coverMime === 'jpg' || coverMime === 'jpeg') coverMime = 'image/jpeg';
          if (coverMime === 'png') coverMime = 'image/png';
          const coverBytes = cover?.data ? Buffer.from(cover.data) : null;
          if (!coverMime.startsWith('image/')) {
            if (coverBytes?.[0] === 0xff && coverBytes?.[1] === 0xd8) coverMime = 'image/jpeg';
            else if (coverBytes?.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') coverMime = 'image/png';
            else if (coverBytes?.subarray(0, 4).toString() === 'RIFF' && coverBytes?.subarray(8, 12).toString() === 'WEBP') coverMime = 'image/webp';
          }
          const coverData = coverBytes && coverMime.startsWith('image/') ? `data:${coverMime};base64,${coverBytes.toString('base64')}` : null;
          songs.push({ id: file, path: file, title: c.title || path.basename(file, path.extname(file)), artist: c.artist || 'Unknown artist', album: c.album || 'Unknown album', duration: metadata.format.duration || 0, bpm: Number(c.bpm) || 0, added: stat.birthtimeMs || stat.mtimeMs, modified: stat.mtimeMs, cover: coverData });
        } catch { addWarning('Some song files could not be accessed.'); }
      }
    }
  }
  if (!root) return { songs, warnings: ['Choose a music folder first.'] };
  await visit(root);
  if (metadataUnavailable) addWarning('Song tags and cover art could not be read, so filenames are being used.');
  return { songs, warnings };
});
ipcMain.handle('scan-playlists', async (_, root) => {
  const supported = new Set(['.wpl', '.m3u', '.m3u8']);
  const files = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) files.push(file);
    }
  }
  await visit(root);
  const decodeXml = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()];
  });
  const result = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      let entries = [];
      if (path.extname(file).toLowerCase() === '.wpl') {
        for (const match of content.matchAll(/<media\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gis)) entries.push(decodeXml(match[2]));
      } else {
        entries = content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      }
      const tracks = entries.map(src => {
        if (/^file:/i.test(src)) { try { src = require('node:url').fileURLToPath(src); } catch { return null; } }
        return path.resolve(path.dirname(file), src);
      }).filter(Boolean);
      if (tracks.length) result.push({ name: path.basename(file, path.extname(file)), path: file, tracks });
    } catch { }
  }
  return result;
});
ipcMain.handle('delete-files', async (_, files) => {
  const uniqueFiles = [...new Set((Array.isArray(files) ? files : []).filter(file => typeof file === 'string'))];
  if (!uniqueFiles.length) return { removed: [], failed: [] };
  const detail = uniqueFiles.length === 1 ? path.basename(uniqueFiles[0]) : `${uniqueFiles.length} selected songs`;
  const result = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel', 'Delete permanently'], defaultId: 0, cancelId: 0, title: 'Delete song files?', message: 'This permanently removes the selected audio files from Windows and your library.', detail });
  if (result.response !== 1) return { removed: [], failed: [] };
  const removed = [], failed = [];
  for (const file of uniqueFiles) {
    try { await fs.unlink(file); removed.push(file); }
    catch { failed.push(file); }
  }
  return { removed, failed };
});
ipcMain.handle('show-in-folder', (_, file) => shell.showItemInFolder(file));
ipcMain.handle('file-url', (_, file) => pathToFileURL(file).href);

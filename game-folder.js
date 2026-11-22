// Read and write filters straight in the player's game folder (File System Access API: Chrome, Edge, Opera).
// The plugin loads every JSON in mods\PD2Resurrected\d2rloader\config\filter\ and reloads a file when it changes.

export const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// Paths from whatever folder the player picks down to d2rloader\config.
const ROUTES = [
  ['mods', 'PD2Resurrected', 'd2rloader', 'config'],
  ['PD2Resurrected', 'd2rloader', 'config'],
  ['d2rloader', 'config'],
  ['config'],
  [],
];

/* A tiny IndexedDB store so the folder is remembered between visits. */
const db = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('pd2r-filter-builder', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function kv(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('kv', mode).objectStore('kv'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dir(parent, name, create = false) {
  try { return await parent.getDirectoryHandle(name, { create }); } catch { return null; }
}

async function resolve(picked) {
  if (picked.name.toLowerCase() === 'filter') return { root: picked, config: null, filterDir: picked };
  for (const route of ROUTES) {
    let at = picked;
    for (const part of route) if (!(at = await dir(at, part))) break;
    if (!at) continue;
    // `config` itself is only accepted when it holds d2rloader's config files.
    if (!route.length && picked.name.toLowerCase() !== 'config') continue;
    return { root: picked, config: at, filterDir: await dir(at, 'filter', true) };
  }
  return null;
}

export async function connect() {
  const picked = await window.showDirectoryPicker({ id: 'pd2r-game', mode: 'readwrite' });
  const conn = await resolve(picked);
  if (!conn) throw new Error(`“${picked.name}” has no mods\\PD2Resurrected folder. Pick the Diablo II Resurrected folder you installed the mod into.`);
  await kv('readwrite', s => s.put(picked, 'folder')).catch(() => {});
  return conn;
}

// The remembered folder, if the browser still lets us use it without a prompt.
export async function remembered() {
  const handle = await kv('readonly', s => s.get('folder')).catch(() => null);
  if (!handle) return null;
  return { handle, granted: (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' };
}

// Needs a click: asks the browser to re-allow the remembered folder.
export async function reconnect(handle) {
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('The browser did not allow access to the folder.');
  const conn = await resolve(handle);
  if (!conn) throw new Error('The remembered folder no longer has the mod in it. Pick the game folder again.');
  return conn;
}

export async function forget() {
  await kv('readwrite', s => s.delete('folder')).catch(() => {});
}

export async function listFilters(conn) {
  const out = [];
  for await (const [name, handle] of conn.filterDir.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.json')) out.push({ name, where: 'filter', handle, modified: (await handle.getFile()).lastModified });
  }
  out.sort((a, b) => b.modified - a.modified);
  if (conn.config) {
    try {
      const handle = await conn.config.getFileHandle('filter.json');
      out.push({ name: 'filter.json', where: 'config', handle, modified: (await handle.getFile()).lastModified });
    } catch { /* no legacy single filter */ }
  }
  return out;
}

export async function readFilter(entry) {
  return (await entry.handle.getFile()).text();
}

export async function exists(conn, name) {
  try { await conn.filterDir.getFileHandle(name); return true; } catch { return false; }
}

export async function writeFilter(conn, entry, name, text) {
  const handle = entry?.handle ?? await conn.filterDir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
  return { name: entry?.name ?? name, where: entry?.where ?? 'filter', handle, modified: Date.now() };
}

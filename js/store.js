// Keeps the last decoded save in IndexedDB so a reload does not need the file again.
const DB = 'tfm2-analyst', STORE = 'saves';
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function put(key, value) {
  const db = await open();
  await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
}
async function get(key) {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly'); const q = t.objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
}
// Champion kits read from the user's game install.
export async function saveKits(v) { try { await put('kits', v); } catch (e) { console.warn('Could not keep champion kits', e); } }
export async function loadKits() { try { return await get('kits'); } catch { return null; } }

export async function saveLast(value) {
  try {
    const db = await open();
    await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, 'last'); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch (e) { console.warn('Could not cache save', e); }
}
export async function loadLast() {
  try {
    const db = await open();
    return await new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly'); const q = t.objectStore(STORE).get('last'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); });
  } catch { return null; }
}
export async function clearLast() {
  try { const db = await open(); const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete('last'); } catch {}
}
export const local = {
  get(k, d) { try { const v = localStorage.getItem('tfm2:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tfm2:' + k, JSON.stringify(v)); } catch {} },
};

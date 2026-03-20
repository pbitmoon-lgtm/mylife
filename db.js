// ═══════════════════════════════════════════════
// My Life — db.js  v3.0 DEFINITIVO
// Storage locale cifrato con IndexedDB
// Dipende da: crypto.js
// Espone: window.DB (dbAll, dbPut, dbDel)
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════════════════
let _db = null;
async function initDB() {
  if (_db) return;
  _db = await new Promise((res,rej) => {
    const r = indexedDB.open('MyLife', 1);
    r.onupgradeneeded = e => {
      ['trips','favorites','notes'].forEach(s => {
        if (!e.target.result.objectStoreNames.contains(s))
          e.target.result.createObjectStore(s, {keyPath:'id'});
      });
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbAll(store) {
  await initDB();
  return new Promise(async (res,rej) => {
    const r = _db.transaction(store,'readonly').objectStore(store).getAll();
    r.onsuccess = async () => {
      const out = [];
      for (const row of r.result) {
        try { out.push({...await CR.decObj(row.data||row), id:row.id}); }
        catch { out.push(row); }
      }
      res(out);
    };
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(store, obj) {
  await initDB();
  const {id, ...data} = obj;
  const enc = await CR.encObj(data);
  return new Promise((res,rej) => {
    const r = _db.transaction(store,'readwrite').objectStore(store).put({id:id||Date.now(), data:enc});
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}
async function dbDel(store, id) {
  await initDB();
  return new Promise((res,rej) => {
    const r = _db.transaction(store,'readwrite').objectStore(store).delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}


window.DB = { dbAll, dbPut, dbDel, initDB };

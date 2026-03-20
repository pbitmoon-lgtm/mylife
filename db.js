// ═══════════════════════════════════════════════════════
// My Life — db.js
// Versione: 1.0.0 DEFINITIVA
//
// RESPONSABILITÀ: storage locale cifrato.
// Questo file USA:
//   - IndexedDB per persistenza
//   - AUTH.getKey() per la chiave di cifratura
//   - CRYPTO per enc/dec oggetti
// Questo file NON SA:
//   - cosa significa il contenuto dei dati
//   - chi è l'utente
//   - come funziona la rete
//
// STORES: trips, favorites, notes
// Ogni record ha forma: { id, data: blob_cifrato }
// ═══════════════════════════════════════════════════════

const DB = (() => {

  const DB_NAME    = 'MyLife';
  const DB_VERSION = 1;
  const STORES     = ['trips', 'favorites', 'notes'];

  let _db = null;

  // ─── INIT ────────────────────────────────────────────
  async function init() {
    if (_db) return;
    _db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        STORES.forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject(req.error);
    });
    console.log('[db] IndexedDB inizializzato');
  }

  // ─── CHIAVE ATTIVA ───────────────────────────────────
  function requireKey() {
    const key = AUTH.getKey();
    if (!key) throw new Error('[db] sessione bloccata — nessuna chiave');
    return key;
  }

  // ─── GET ALL ─────────────────────────────────────────
  // Legge tutti i record da uno store e li decifra.
  // Record non cifrati (legacy) passano direttamente.
  async function getAll(store) {
    await init();
    const key = requireKey();

    return new Promise(async (resolve, reject) => {
      const tx  = _db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = async () => {
        const results = [];
        for (const row of req.result) {
          try {
            const decrypted = await CRYPTO.decryptObject(row.data || row, key);
            results.push({ ...decrypted, id: row.id });
          } catch (e) {
            console.warn(`[db] errore decifratura record ${row.id}:`, e);
            // Non blocca — restituisce il record così com'è
            results.push(row);
          }
        }
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ─── PUT ─────────────────────────────────────────────
  // Cifra e salva un oggetto nello store.
  // Se l'oggetto ha già un id, sovrascrive.
  // Se non ha id, ne genera uno basato su timestamp.
  async function put(store, obj) {
    await init();
    const key = requireKey();

    const { id, ...data } = obj;
    const recordId        = id || Date.now();
    const encData         = await CRYPTO.encryptObject(data, key);

    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put({ id: recordId, data: encData });
      req.onsuccess = () => resolve(recordId);
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── DELETE ──────────────────────────────────────────
  async function remove(store, id) {
    await init();
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── CLEAR STORE ─────────────────────────────────────
  async function clearStore(store) {
    await init();
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── CLEAR ALL ───────────────────────────────────────
  // Cancella tutti i dati. Usato solo da reset completo.
  async function clearAll() {
    await init();
    for (const store of STORES) {
      await clearStore(store);
    }
    console.log('[db] tutti i dati cancellati');
  }

  // ─── EXPORT ──────────────────────────────────────────
  // Esporta tutti i dati decifrati in JSON.
  async function exportAll() {
    const result = {};
    for (const store of STORES) {
      result[store] = await getAll(store);
    }
    result.exportedAt = new Date().toISOString();
    return result;
  }

  return { init, getAll, put, remove, clearStore, clearAll, exportAll };

})();

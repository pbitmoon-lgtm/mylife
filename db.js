// ═══════════════════════════════════════════════════════
// My Life — db.js (PRODUZIONE - ROBUSTO E ANTI-CRASH)
// Tiered Storage Isolato.
// Gestisce il salvataggio e previene il blocco della RAM.
// ═══════════════════════════════════════════════════════

import State from './state.js';

const StorageManager = (() => {

  const DB_NAME    = 'MyLife_Vault';
  const DB_VERSION = 1;
  let _db          = null;

  // ─── INIT INDEXEDDB ───────────────────────────────────
  async function initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        // Tier 1: Testi leggeri
        if (!db.objectStoreNames.contains('core_records')) {
          const store = db.createObjectStore('core_records', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        // Tier 2: Media pesanti
        if (!db.objectStoreNames.contains('media_assets')) {
          db.createObjectStore('media_assets', { keyPath: 'id' });
        }
      };

      req.onsuccess = () => { _db = req.result; resolve(); };
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── OPERAZIONI CRUD DI BASSO LIVELLO ─────────────────
  function writeStore(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(data);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  function readAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function readStore(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  function clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  function removeStore(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── ASCOLTO EVENTI DI SISTEMA ────────────────────────

  State.subscribe('CRYPTO_KEY_DERIVED', async () => {
    try {
      await initDB();
      State.dispatch('STORAGE_MOUNTED');
    } catch (err) {
      State.dispatch('SYSTEM_ERROR', { error: 'Fallimento montaggio disco: ' + err.message });
    }
  });

  // ─── SALVATAGGIO DATI ─────────────────────────────────
  State.subscribe('INTENT_SAVE_RECORD', ({ recordId, type, textPayload, assetPayloads = [] }) => {
    // 1. Cifra gli asset (foto/audio)
    assetPayloads.forEach(asset => {
      State.dispatch('REQUEST_ENCRYPT', { id: asset.id, payload: asset.data, isAsset: true });
    });

    // 2. Prepara e cifra il testo agganciando gli ID degli asset
    const coreData = { ...textPayload, type, assetIds: assetPayloads.map(a => a.id) };
    State.dispatch('REQUEST_ENCRYPT', { id: recordId, payload: coreData, isAsset: false });
  });

  State.subscribe('PAYLOAD_ENCRYPTED', async ({ id, buffer, isAsset }) => {
    try {
      const storeName = isAsset ? 'media_assets' : 'core_records';
      await writeStore(storeName, { id, data: buffer });
      
      if (isAsset) State.dispatch('ASSET_COMMITTED', { id });
      else State.dispatch('RECORD_COMMITTED', { id });
    } catch (err) {
      State.dispatch('STORAGE_WRITE_ERROR', { id, error: err.message });
    }
  });

  // ─── LETTURA DATI ─────────────────────────────────────
  State.subscribe('INTENT_LOAD_RECORDS', async ({ type, requestId }) => {
    try {
      const all = await readAll('core_records');
      all.forEach(record => {
        State.dispatch('REQUEST_DECRYPT', { id: record.id, buffer: record.data, isAsset: false, requestId });
      });
    } catch (err) {
      console.error('[db] errore lettura:', err);
    }
  });

  State.subscribe('INTENT_LOAD_ASSET', async ({ assetId }) => {
    try {
      const asset = await readStore('media_assets', assetId);
      if (!asset) return State.dispatch('ASSET_NOT_FOUND', { assetId });
      
      State.dispatch('REQUEST_DECRYPT', { id: assetId, buffer: asset.data, isAsset: true });
    } catch (err) {
      State.dispatch('ASSET_LOAD_ERROR', { assetId, error: err.message });
    }
  });

  State.subscribe('INTENT_DELETE_RECORD', async ({ id, deleteAssets = [] }) => {
    try {
      await removeStore('core_records', id);
      for (const assetId of deleteAssets) await removeStore('media_assets', assetId);
      State.dispatch('RECORD_DELETED', { id });
    } catch (err) {
      State.dispatch('DELETE_ERROR', { id, error: err.message });
    }
  });

  // ─── BACKUP E RIPRISTINO SICURO (CODA SEQUENZIALE) ────
  State.subscribe('INTENT_EXPORT_ALL', async () => {
    try {
      const records = await readAll('core_records');
      const assets  = await readAll('media_assets');
      State.dispatch('EXPORT_READY', { records, assets, ts: Date.now() });
    } catch (err) {
      State.dispatch('EXPORT_ERROR', { error: err.message });
    }
  });

  State.subscribe('INTENT_RESTORE_VAULT', async ({ records, assets }) => {
    try {
      await clearStore('core_records');
      await clearStore('media_assets');

      // 1. Ripristino Testi (Veloci)
      for (const record of records) {
        State.dispatch('INTENT_SAVE_RECORD', {
          recordId: record.id, type: record.type, textPayload: record
        });
      }

      // 2. Ripristino Asset in Coda Sequenziale (Anti-Crash RAM)
      let done = 0;
      const total = assets.length;

      for (const asset of assets) {
        if (!asset.data) continue;

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout cifratura')), 15000);

          const unsubOk = State.subscribe('ASSET_COMMITTED', (payload) => {
            if (payload.id !== asset.id) return;
            clearTimeout(timeout); unsubOk(); unsubErr(); resolve();
          });

          const unsubErr = State.subscribe('STORAGE_WRITE_ERROR', (payload) => {
            if (payload.id !== asset.id) return;
            clearTimeout(timeout); unsubOk(); unsubErr(); reject(new Error(`Errore asset ${asset.id}`));
          });

          State.dispatch('REQUEST_ENCRYPT', { id: asset.id, payload: asset.data, isAsset: true });
        });

        done++;
        State.dispatch('RESTORE_PROGRESS', { step: 'assets', progress: done / total, done, total });
      }

      State.dispatch('BACKUP_RESTORED', { recordCount: records.length, assetCount: assets.length });

    } catch (err) {
      console.error('[db] restore error:', err);
      State.dispatch('RESTORE_ERROR', { error: 'Ripristino fallito: ' + err.message });
    }
  });

  State.subscribe('INTENT_CLEAR_ALL', async () => {
    try {
      await clearStore('core_records');
      await clearStore('media_assets');
      State.dispatch('STORAGE_CLEARED');
    } catch (err) {
      State.dispatch('CLEAR_ERROR', { error: err.message });
    }
  });

  return {}; // Muro di gomma: nessuna variabile globale esportata
})();

export default StorageManager;
// ═══════════════════════════════════════════════════════
// My Life — db.js
// Tiered Storage Isolato.
// Si monta SOLO dopo CRYPTO_KEY_DERIVED.
// Tier 1: core_records (testo + metadati, caricamento veloce)
// Tier 2: media_assets (blob, caricamento on-demand)
//
// Non conosce AES o la UI.
// Comunica solo tramite eventi.
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
        // Tier 1: record leggeri (note testo, metadati viaggi, preferiti)
        if (!db.objectStoreNames.contains('core_records')) {
          const store = db.createObjectStore('core_records', { keyPath: 'id' });
          store.createIndex('type',      'type',      { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        // Tier 2: blob pesanti (immagini, audio, video)
        if (!db.objectStoreNames.contains('media_assets')) {
          db.createObjectStore('media_assets', { keyPath: 'id' });
        }
      };

      req.onsuccess = e => { _db = e.target.result; resolve(); };
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── OPERAZIONI CRUD BASSO LIVELLO ────────────────────
  async function write(storeName, record) {
    // Rispetta il freeze del backup — non scrive durante lo snapshot
    if (typeof BackupModule !== 'undefined' && BackupModule.isFrozen?.()) {
      console.warn('[db] write bloccata: backup freeze attivo');
      throw new Error('STORAGE_FROZEN');
    }
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function read(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  async function readAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function readByType(type) {
    return new Promise((resolve, reject) => {
      const tx    = _db.transaction('core_records', 'readonly');
      const index = tx.objectStore('core_records').index('type');
      const req   = index.getAll(type);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function remove(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  async function clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx  = _db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ─── GESTORI EVENTI ───────────────────────────────────

  // 1. Si monta quando la chiave è in RAM
  State.subscribe('CRYPTO_KEY_DERIVED', async () => {
    try {
      await initDB();
      console.log('[db] storage montato');
      State.dispatch('STORAGE_MOUNTED');
    } catch (err) {
      console.error('[db] errore mount:', err);
      State.dispatch('SYSTEM_ERROR', { error: 'Fallimento montaggio storage: ' + err.message });
    }
  });

  // 2. Salva un record (Tier 1 + eventuali asset Tier 2)
  // Chiamato dalla UI con INTENT_SAVE_RECORD
  State.subscribe('INTENT_SAVE_RECORD', ({ recordId, type, textPayload, assetPayloads = [] }) => {
    const id = recordId || Date.now();

    // Cifra gli asset del Tier 2 in parallelo
    assetPayloads.forEach(asset => {
      State.dispatch('REQUEST_ENCRYPT', {
        id:      asset.id,
        payload: asset.data,
        isAsset: true
      });
    });

    // Cifra il record Tier 1 con i puntatori agli asset
    State.dispatch('REQUEST_ENCRYPT', {
      id,
      payload: {
        ...textPayload,
        type,
        assetIds:  assetPayloads.map(a => a.id),
        updatedAt: Date.now(),
      },
      isAsset: false
    });
  });

  // 3. Riceve payload cifrati e li scrive nel tier corretto
  State.subscribe('PAYLOAD_ENCRYPTED', async ({ id, buffer, isAsset }) => {
    try {
      const storeName = isAsset ? 'media_assets' : 'core_records';
      const data      = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      await write(storeName, { id, data });

      if (!isAsset) {
        State.dispatch('RECORD_COMMITTED', { id });
      } else {
        State.dispatch('ASSET_COMMITTED', { id });
      }
    } catch (err) {
      console.error('[db] write error:', err);
      State.dispatch('STORAGE_WRITE_ERROR', { id, error: err.message });
    }
  });

  // 4. Leggi tutti i record di un tipo
  State.subscribe('INTENT_LOAD_RECORDS', async ({ type, requestId }) => {
    try {
      const records = await readByType(type);
      // Richiede decifratura per ogni record
      records.forEach(r => {
        State.dispatch('REQUEST_DECRYPT', {
          id:      r.id,
          buffer:  r.data,
          isAsset: false,
          requestId
        });
      });
      State.dispatch('RECORDS_LOAD_STARTED', { type, count: records.length, requestId });
    } catch (err) {
      State.dispatch('RECORDS_LOAD_ERROR', { type, error: err.message });
    }
  });

  // 5. Leggi un singolo asset (Tier 2, on-demand)
  State.subscribe('INTENT_LOAD_ASSET', async ({ assetId }) => {
    try {
      const asset = await read('media_assets', assetId);
      if (!asset) {
        State.dispatch('ASSET_NOT_FOUND', { assetId });
        return;
      }
      State.dispatch('REQUEST_DECRYPT', {
        id:      assetId,
        buffer:  asset.data,
        isAsset: true
      });
    } catch (err) {
      State.dispatch('ASSET_LOAD_ERROR', { assetId, error: err.message });
    }
  });

  // 6. Elimina un record
  State.subscribe('INTENT_DELETE_RECORD', async ({ id, deleteAssets = [] }) => {
    try {
      await remove('core_records', id);
      for (const assetId of deleteAssets) {
        await remove('media_assets', assetId);
      }
      State.dispatch('RECORD_DELETED', { id });
    } catch (err) {
      State.dispatch('DELETE_ERROR', { id, error: err.message });
    }
  });

  // 7. Export completo per backup JSON (settings.js)
  State.subscribe('INTENT_EXPORT_ALL', async () => {
    try {
      const records = await readAll('core_records');
      const assets  = await readAll('media_assets');
      State.dispatch('EXPORT_READY', { records, assets, ts: Date.now() });
    } catch (err) {
      State.dispatch('EXPORT_ERROR', { error: err.message });
    }
  });

  // 8. Export per backup fisico cifrato (backup.js)
  // Decifra i record e li passa a backup.js per la ri-cifratura
  // con chiave indipendente dal dispositivo
  State.subscribe('INTENT_EXPORT_ALL_FOR_BACKUP', async () => {
    try {
      const rawRecords = await readAll('core_records');
      const rawAssets  = await readAll('media_assets');

      let processed = 0;
      const total   = rawRecords.length + rawAssets.length;

      // Decifra e invia ogni record tramite eventi esistenti
      for (const r of rawRecords) {
        State.dispatch('REQUEST_DECRYPT', { id: r.id, buffer: r.data, isAsset: false });
      }
      for (const a of rawAssets) {
        State.dispatch('REQUEST_DECRYPT', { id: a.id, buffer: a.data, isAsset: true });
      }

      // Segnala a backup.js che lo snapshot è completo
      State.dispatch('BACKUP_SNAPSHOT_COMPLETE', {
        recordCount: rawRecords.length,
        assetCount:  rawAssets.length,
      });
    } catch (err) {
      State.dispatch('BACKUP_ERROR', { error: 'Snapshot fallito: ' + err.message });
    }
  });

  // 9. Ripristino vault da backup fisico — Coda Sequenziale
  // NON lanciare tutti gli eventi in parallelo:
  // 100 asset da 3MB ciascuno = 300MB in RAM simultanei → OOM crash.
  // La coda processa UN asset alla volta:
  // cifra → ASSET_COMMITTED → prossimo asset → RAM sempre piatta.
  State.subscribe('INTENT_RESTORE_VAULT', async ({ records, assets }) => {
    try {
      // Svuota gli store esistenti
      await clear('core_records');
      await clear('media_assets');

      const total = records.length + assets.length;
      let done    = 0;

      // ── Tier 1: record testo — leggeri, processabili in batch ──
      for (const record of records) {
        State.dispatch('INTENT_SAVE_RECORD', {
          recordId:    record.id,
          type:        record.type,
          textPayload: record,
        });
        done++;
        State.dispatch('RESTORE_PROGRESS', {
          step:     'records',
          progress: done / total,
          done,
          total,
        });
        // Cede il controllo al browser ogni 10 record per non bloccare la UI
        if (done % 10 === 0) await new Promise(r => setTimeout(r, 0));
      }

      // ── Tier 2: asset binari — UNO ALLA VOLTA per tenere la RAM piatta ──
      for (const asset of assets) {
        if (!asset.data) { done++; continue; }

        // Attende ASSET_COMMITTED prima di processare il prossimo
        // Questo garantisce che la RAM venga liberata tra un asset e l'altro
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubOk(); unsubErr();
            reject(new Error(`Timeout cifratura asset ${asset.id}`));
          }, 30000); // 30s per asset — sufficiente anche per video grandi

          const unsubOk = State.subscribe('ASSET_COMMITTED', ({ id }) => {
            if (id !== asset.id) return; // non è il nostro asset
            clearTimeout(timeout);
            unsubOk(); unsubErr();
            resolve();
          });

          const unsubErr = State.subscribe('STORAGE_WRITE_ERROR', ({ id }) => {
            if (id !== asset.id) return;
            clearTimeout(timeout);
            unsubOk(); unsubErr();
            reject(new Error(`Errore scrittura asset ${asset.id}`));
          });

          // Lancia la cifratura di questo singolo asset
          State.dispatch('REQUEST_ENCRYPT', {
            id:      asset.id,
            payload: asset.data,
            isAsset: true,
          });
        });

        done++;
        State.dispatch('RESTORE_PROGRESS', {
          step:     'assets',
          progress: done / total,
          done,
          total,
        });
      }

      State.dispatch('BACKUP_RESTORED', {
        recordCount: records.length,
        assetCount:  assets.length,
      });

    } catch (err) {
      console.error('[db] restore error:', err);
      State.dispatch('RESTORE_ERROR', { error: 'Ripristino DB fallito: ' + err.message });
    }
  });

  // 8. Clear totale (reset)
  State.subscribe('INTENT_CLEAR_ALL', async () => {
    try {
      await clear('core_records');
      await clear('media_assets');
      State.dispatch('STORAGE_CLEARED');
    } catch (err) {
      State.dispatch('CLEAR_ERROR', { error: err.message });
    }
  });

  return {}; // Modulo sigillato

})();

export default StorageManager;

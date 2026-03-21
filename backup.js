// ═══════════════════════════════════════════════════════
// My Life — backup.js
// Protocollo di Esportazione Fisica Locale (Self-Custody)
//
// PRINCIPIO: il backup è completamente indipendente dalla
// chiave del dispositivo. Se il telefono viene distrutto,
// il file .enc + la password di backup bastano per ripristinare
// tutto su un nuovo device.
//
// FLUSSO:
//   INTENT_CREATE_BACKUP
//     → freeze writes
//     → snapshot Tier1 + Tier2
//     → re-encrypt con password backup (PBKDF2 600k iter)
//     → export mylife_vault_YYYYMMDD.enc
//
//   INTENT_RESTORE_BACKUP
//     → import file .enc
//     → decrypt con password backup
//     → ripopola IndexedDB (Tier1 + Tier2)
//     → BACKUP_RESTORED
//
// FORMATO FILE .enc (binario strutturato):
//   [4 byte]  magic: 0x4D4C4256 ("MLBV")
//   [4 byte]  version: 1
//   [16 byte] salt PBKDF2
//   [12 byte] IV AES-GCM
//   [4 byte]  lunghezza manifest JSON
//   [N byte]  manifest JSON cifrato (metadati)
//   [4 byte]  lunghezza payload
//   [N byte]  payload cifrato (tutti i dati)
// ═══════════════════════════════════════════════════════

import State from './state.js';

const BackupModule = (() => {

  // Flag globale di freeze — blocca scritture durante snapshot
  let _frozen = false;

  // ─── MAGIC BYTES ─────────────────────────────────────
  const MAGIC   = new Uint8Array([0x4D, 0x4C, 0x42, 0x56]); // "MLBV"
  const VERSION = 1;

  // ─── PBKDF2 PER BACKUP ───────────────────────────────
  // 600.000 iterazioni — accettabile per backup offline (2-3s)
  // Non è Argon2id (non disponibile in Web Crypto nativo)
  // ma con questo numero di iterazioni offre protezione equivalente
  // contro attacchi offline su hardware consumer
  const BACKUP_ITER = 600000;

  async function deriveBackupKey(password, salt) {
    const base = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: BACKUP_ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ─── ENCODE / DECODE UINT32 ──────────────────────────
  function encodeU32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, false); // big-endian
    return b;
  }

  function decodeU32(buf, offset) {
    return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, false);
  }

  // ─── SERIALIZZA TUTTI I DATI ─────────────────────────
  // Riceve i record già decifrati da db.js e li impacchetta
  // in un unico oggetto JSON strutturato
  function serializeVault(records, assets) {
    const vault = {
      version:     VERSION,
      exportedAt:  new Date().toISOString(),
      recordCount: records.length,
      assetCount:  assets.length,
      records,
      assets: assets.map(a => ({
        id:   a.id,
        // Converti Uint8Array in array base64 per serializzazione JSON
        data: a.data ? btoa(String.fromCharCode(...new Uint8Array(a.data))) : null,
      })),
    };
    return new TextEncoder().encode(JSON.stringify(vault));
  }

  // ─── DESERIALIZZA VAULT ──────────────────────────────
  function deserializeVault(bytes) {
    const json = new TextDecoder().decode(bytes);
    const vault = JSON.parse(json);
    // Riconverti assets da base64 a Uint8Array
    vault.assets = (vault.assets || []).map(a => ({
      id:   a.id,
      data: a.data ? new Uint8Array(
        atob(a.data).split('').map(c => c.charCodeAt(0))
      ) : null,
    }));
    return vault;
  }

  // ─── ASSEMBLA FILE .enc ───────────────────────────────
  // Formato binario strutturato per massima portabilità
  function assembleEncFile(salt, iv, manifestBytes, payloadBytes) {
    const manifestEnc = manifestBytes;
    const payloadEnc  = payloadBytes;

    const total =
      MAGIC.length +     // 4
      4 +                // version
      salt.length +      // 16
      iv.length +        // 12
      4 +                // manifest length
      manifestEnc.length +
      4 +                // payload length
      payloadEnc.length;

    const buf = new Uint8Array(total);
    let offset = 0;

    const write = (data) => { buf.set(data, offset); offset += data.length; };

    write(MAGIC);
    write(encodeU32(VERSION));
    write(salt);
    write(iv);
    write(encodeU32(manifestEnc.length));
    write(manifestEnc);
    write(encodeU32(payloadEnc.length));
    write(payloadEnc);

    return buf;
  }

  // ─── SMONTA FILE .enc ────────────────────────────────
  function disassembleEncFile(buf) {
    let offset = 0;

    // Verifica magic bytes
    const magic = buf.slice(0, 4);
    if (!magic.every((b, i) => b === MAGIC[i])) {
      throw new Error('File non riconosciuto — magic bytes non validi');
    }
    offset += 4;

    const version = decodeU32(buf, offset); offset += 4;
    if (version !== VERSION) {
      throw new Error(`Versione backup non supportata: ${version}`);
    }

    const salt = buf.slice(offset, offset + 16); offset += 16;
    const iv   = buf.slice(offset, offset + 12); offset += 12;

    const manifestLen = decodeU32(buf, offset); offset += 4;
    const manifestEnc = buf.slice(offset, offset + manifestLen); offset += manifestLen;

    const payloadLen = decodeU32(buf, offset); offset += 4;
    const payloadEnc = buf.slice(offset, offset + payloadLen);

    return { salt, iv, manifestEnc, payloadEnc };
  }

  // ─── CREA BACKUP ─────────────────────────────────────
  State.subscribe('INTENT_CREATE_BACKUP', async ({ password }) => {
    if (!password || password.length < 8) {
      State.dispatch('BACKUP_ERROR', {
        error: 'Password backup troppo corta (minimo 8 caratteri)'
      });
      return;
    }

    try {
      // 1. FREEZE: blocca nuove scritture durante lo snapshot
      _frozen = true;
      State.dispatch('BACKUP_FREEZE_START');
      console.log('[backup] freeze writes...');

      // Piccola pausa per permettere alle scritture in corso di completarsi
      await new Promise(r => setTimeout(r, 150));

      // 2. SNAPSHOT: richiedi tutti i dati a db.js
      // Usiamo una Promise che si risolve quando db.js risponde
      // State.once() sostituisce il pattern manual subscribe+timeout+unsub
      // Raccoglie i payload mentre arrivano, poi si risolve
      const { records, assets } = await new Promise((resolve, reject) => {
        const collectedRecords = [];
        const collectedAssets  = [];

        // Raccoglie i record mentre vengono decifrati
        const unsubDecrypt = State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset, requestId }) => {
          if (requestId !== 'backup_export') return;
          if (isAsset) collectedAssets.push({ id, data: payload });
          else         collectedRecords.push({ id, ...payload });
        });

        // once() aspetta il segnale di completamento snapshot
        // e si scollega automaticamente — nessun timeout manuale
        State.once('BACKUP_SNAPSHOT_COMPLETE', () => {
          unsubDecrypt(); // scollega il raccoglitore
          resolve({ records: collectedRecords, assets: collectedAssets });
        });

        // Fallback timeout — se db.js non risponde entro 10s
        setTimeout(() => {
          unsubDecrypt();
          reject(new Error('Timeout snapshot — db.js non ha risposto'));
        }, 10000);

        State.dispatch('INTENT_EXPORT_ALL_FOR_BACKUP');
      });

      console.log(`[backup] snapshot: ${records.length} record, ${assets.length} asset`);

      // 3. UNFREEZE: le scritture possono riprendere
      _frozen = false;
      State.dispatch('BACKUP_FREEZE_END');

      // 4. SERIALIZZA
      const payloadBytes = serializeVault(records, assets);

      // 5. DERIVA CHIAVE DA PASSWORD BACKUP
      // Questa chiave è indipendente dalla chiave del dispositivo
      State.dispatch('BACKUP_PROGRESS', { step: 'derive_key', progress: 0.3 });
      const salt      = crypto.getRandomValues(new Uint8Array(16));
      const backupKey = await deriveBackupKey(password, salt);

      // 6. CIFRA PAYLOAD
      State.dispatch('BACKUP_PROGRESS', { step: 'encrypt', progress: 0.6 });
      const iv     = crypto.getRandomValues(new Uint8Array(12));
      const ctBuf  = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, backupKey, payloadBytes
      );
      const payloadEnc = new Uint8Array(ctBuf);

      // 7. CIFRA MANIFEST (metadati non sensibili)
      const manifest = JSON.stringify({
        exportedAt:  new Date().toISOString(),
        recordCount: records.length,
        assetCount:  assets.length,
        appVersion:  'v4.0',
      });
      const manifestBytes = new TextEncoder().encode(manifest);
      const manifestCtBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, backupKey, manifestBytes
      );
      const manifestEnc = new Uint8Array(manifestCtBuf);

      // 8. ASSEMBLA FILE .enc
      const encFile = assembleEncFile(salt, iv, manifestEnc, payloadEnc);

      // 9. ESPORTA TRAMITE BLOB URL
      State.dispatch('BACKUP_PROGRESS', { step: 'export', progress: 0.9 });
      const date     = new Date().toISOString().split('T')[0].replace(/-/g,'');
      const filename = `mylife_vault_${date}.enc`;
      const blob     = new Blob([encFile], { type: 'application/octet-stream' });
      const url      = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Revoca l'URL dopo 60s per liberare memoria
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      console.log(`[backup] esportato: ${filename} (${(encFile.length / 1024).toFixed(1)} KB)`);
      State.dispatch('BACKUP_COMPLETE', {
        filename,
        sizeKB:      Math.round(encFile.length / 1024),
        recordCount: records.length,
        assetCount:  assets.length,
      });

    } catch (err) {
      _frozen = false;
      State.dispatch('BACKUP_FREEZE_END');
      console.error('[backup] errore:', err);
      State.dispatch('BACKUP_ERROR', { error: err.message });
    }
  });

  // ─── RIPRISTINA BACKUP ────────────────────────────────
  State.subscribe('INTENT_RESTORE_BACKUP', async ({ fileBuffer, password }) => {
    if (!password || !fileBuffer) {
      State.dispatch('RESTORE_ERROR', { error: 'File o password mancanti' });
      return;
    }

    try {
      State.dispatch('RESTORE_PROGRESS', { step: 'parse', progress: 0.1 });

      // 1. SMONTA il file .enc
      const buf = new Uint8Array(fileBuffer);
      const { salt, iv, manifestEnc, payloadEnc } = disassembleEncFile(buf);

      // 2. DERIVA CHIAVE DALLA PASSWORD
      State.dispatch('RESTORE_PROGRESS', { step: 'derive_key', progress: 0.2 });
      const backupKey = await deriveBackupKey(password, salt);

      // 3. DECIFRA MANIFEST (verifica password)
      State.dispatch('RESTORE_PROGRESS', { step: 'verify', progress: 0.4 });
      let manifest;
      try {
        const manifestBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv }, backupKey, manifestEnc
        );
        manifest = JSON.parse(new TextDecoder().decode(manifestBuf));
        console.log('[backup] manifest:', manifest);
      } catch {
        throw new Error('Password backup errata');
      }

      // 4. DECIFRA PAYLOAD
      State.dispatch('RESTORE_PROGRESS', { step: 'decrypt', progress: 0.6 });
      const payloadBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, backupKey, payloadEnc
      );

      // 5. DESERIALIZZA
      const vault = deserializeVault(new Uint8Array(payloadBuf));
      console.log(`[backup] vault: ${vault.records.length} record, ${vault.assets.length} asset`);

      // 6. RIPOPOLA IndexedDB
      State.dispatch('RESTORE_PROGRESS', { step: 'restore', progress: 0.8 });
      State.dispatch('INTENT_RESTORE_VAULT', {
        records: vault.records,
        assets:  vault.assets,
      });

    } catch (err) {
      console.error('[backup] restore error:', err);
      State.dispatch('RESTORE_ERROR', { error: err.message });
    }
  });

  // ─── ASCOLTA FREEZE in db.js ─────────────────────────
  // db.js deve controllare questo flag prima di scrivere
  function isFrozen() { return _frozen; }

  // ─── ESPONI PER UI ────────────────────────────────────
  const pub = { isFrozen };
  window.BackupModule = pub;
  return pub;

})();

export default BackupModule;

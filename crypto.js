// ═══════════════════════════════════════════════════════
// My Life — crypto.js
// Motore Crittografico Isolato.
// Non esporta nulla pubblicamente — comunica solo via eventi.
// Non conosce UI, IndexedDB, o la logica applicativa.
//
// Flusso:
//   ← AUTH_SUCCESS_PRF      → deriva Master Key → CRYPTO_KEY_DERIVED
//   ← REQUEST_ENCRYPT       → cifra → PAYLOAD_ENCRYPTED
//   ← REQUEST_DECRYPT       → decifra → PAYLOAD_DECRYPTED
//   ← CRYPTO_LOCK           → cancella chiave dalla RAM
// ═══════════════════════════════════════════════════════

import State from './state.js';

const CryptoEngine = (() => {

  let _masterKey = null; // chiave in RAM, mai su disco

  // ─── DERIVAZIONE MASTER KEY (HKDF) ────────────────────
  // Input: rawBytes dall'hardware (WebAuthn PRF o PIN hash)
  // Output: chiave AES-256-GCM non estraibile in RAM
  async function deriveMasterKey(rawBytes) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', rawBytes, { name: 'HKDF' }, false, ['deriveKey']
    );
    _masterKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife:domain:v4'),
        info: new TextEncoder().encode('MyLife Master Key v4')
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, // NON estraibile — non esce mai dalla RAM
      ['encrypt', 'decrypt']
    );
  }

  // ─── AES-256-GCM ENCRYPT ──────────────────────────────
  // Formato output: Uint8Array = [IV (12 byte) | Ciphertext]
  async function encryptBuffer(dataBuffer) {
    if (!_masterKey) throw new Error('Sistema crittografico bloccato');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, _masterKey, dataBuffer
    );
    // Combina IV + CipherText in un unico buffer
    const combined = new Uint8Array(12 + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), 12);
    return combined;
  }

  // ─── AES-256-GCM DECRYPT ──────────────────────────────
  // Input: Uint8Array = [IV (12 byte) | Ciphertext]
  async function decryptBuffer(combinedBuffer) {
    if (!_masterKey) throw new Error('Sistema crittografico bloccato');
    const buf = combinedBuffer instanceof Uint8Array
      ? combinedBuffer
      : new Uint8Array(combinedBuffer);
    const iv         = buf.slice(0, 12);
    const ciphertext = buf.slice(12);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, _masterKey, ciphertext
    );
  }

  // ─── ENCRYPT OBJECT (convenienza per la UI) ──────────
  async function encryptObject(obj) {
    const encoded = new TextEncoder().encode(JSON.stringify(obj));
    return encryptBuffer(encoded);
  }

  // ─── DECRYPT OBJECT (convenienza per la UI) ──────────
  async function decryptObject(buffer) {
    const raw = await decryptBuffer(buffer);
    return JSON.parse(new TextDecoder().decode(raw));
  }

  // ─── GESTORI EVENTI ───────────────────────────────────

  // 1. Hardware ha autenticato — deriva la chiave
  State.subscribe('AUTH_SUCCESS_PRF', async ({ rawBytes, seed, words, isSetup }) => {
    try {
      await deriveMasterKey(rawBytes);
      console.log('[crypto] master key derivata');

      if (isSetup && seed) {
        // Setup: cifra e persisti il seed
        const encSeed = await encryptBuffer(seed);
        State.dispatch('CRYPTO_PERSIST_SEED', { encryptedSeed: Array.from(encSeed) });
        // Rendi seed disponibile al wallet
        State.dispatch('SEED_AVAILABLE', { seed });
      } else {
        // Login normale: decripta il seed cifrato salvato
        // Il seed cifrato è nel localStorage — lo leggiamo e decriptiamo
        try {
          const userRaw = localStorage.getItem('ml_user_v4');
          const user    = userRaw ? JSON.parse(userRaw) : null;
          if (user?.encryptedSeed) {
            const decrypted = await decryptBuffer(new Uint8Array(user.encryptedSeed));
            const seed      = new Uint8Array(decrypted);
            State.dispatch('SEED_AVAILABLE', { seed });
          }
        } catch (e) {
          console.warn('[crypto] impossibile decriptare seed per wallet:', e.message);
        }
      }

      State.dispatch('CRYPTO_KEY_DERIVED', { isSetup, words });
    } catch (err) {
      console.error('[crypto] errore derivazione:', err);
      State.dispatch('SYSTEM_ERROR', { error: 'Fallimento derivazione chiave: ' + err.message });
    }
  });

  // 2. Richiesta cifratura da db.js o dalla UI
  State.subscribe('REQUEST_ENCRYPT', async ({ id, payload, isAsset }) => {
    try {
      const buffer = await encryptObject(payload);
      State.dispatch('PAYLOAD_ENCRYPTED', { id, buffer: Array.from(buffer), isAsset });
    } catch (err) {
      console.error('[crypto] encrypt error:', err);
      State.dispatch('ENCRYPTION_FAILED', { id, error: err.message });
    }
  });

  // 3. Richiesta decifratura — requestId viene preservato e ripassato
  State.subscribe('REQUEST_DECRYPT', async ({ id, buffer, isAsset, requestId }) => {
    try {
      const arr     = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const payload = await decryptObject(arr);
      // requestId è CRITICO: permette ai moduli (notes, calendar, map)
      // di filtrare solo i record che hanno richiesto loro
      State.dispatch('PAYLOAD_DECRYPTED', { id, payload, isAsset, requestId });
    } catch (err) {
      console.error('[crypto] decrypt error:', err);
      State.dispatch('DECRYPTION_FAILED', { id, error: err.message });
    }
  });

  // 4. Lock — cancella la chiave dalla RAM
  State.subscribe('CRYPTO_LOCK', () => {
    _masterKey = null;
    console.log('[crypto] chiave rimossa dalla RAM');
    State.dispatch('CRYPTO_LOCKED');
  });

  return {}; // Modulo sigillato — nessuna esposizione pubblica

})();

export default CryptoEngine;

// ═══════════════════════════════════════════════════════
// My Life — auth.js
// Versione: 1.0.0 DEFINITIVA
//
// RESPONSABILITÀ: identità utente e accesso.
// Questo file SA:
//   - chi sei (device fingerprint + userId)
//   - se puoi entrare (PIN corretto)
//   - come recuperare l'accesso (12 parole)
//   - come spostarti su un nuovo device
// Questo file USA:
//   - crypto.js per gli algoritmi
//   - localStorage per il file utente
// Questo file NON SA:
//   - cosa contengono i dati dell'app
//   - come funziona la rete
//   - come funziona la UI
//
// FORMATO FILE UTENTE (v:1 — non cambia mai):
// {
//   v:              "1"           versione formato
//   userId:         "hex..."      ID anonimo univoco
//   deviceId:       "hex..."      fingerprint device
//   created:        "YYYY-MM-DD"  data creazione
//   migratedAt:     "YYYY-MM-DD"  data migrazione (se applicabile)
//   salt:           "hex..."      sale PBKDF2
//   iter:           number        iterazioni calibrate
//   pinCheck:       "hex..."      verifica rapida PIN
//   encSeed:        { iv, d }     seed cifrato
//   backupVerified: boolean       12 parole confermate
// }
//
// REGOLA: il formato v:1 non cambia mai.
// Campi futuri vengono AGGIUNTI, mai modificati.
// ═══════════════════════════════════════════════════════

const AUTH = (() => {

  const STORAGE_KEY = 'ml_user_v1';
  const FORMAT_VER  = '1';

  // ─── DEVICE FINGERPRINT ──────────────────────────────
  // Identifica il device in modo stabile.
  // USA: UUID generato una volta + schermo + timezone
  // NON USA: user agent (cambia con aggiornamenti browser)
  //
  // Il UUID viene generato al primo avvio e salvato.
  // Non cambia mai finché non si cancella il localStorage.
  // Se cambia il localStorage → device non riconosciuto
  // → l'utente inserisce le 12 parole → migrazione.
  let _deviceId = null;

  async function getDeviceId() {
    if (_deviceId) return _deviceId;

    // UUID stabile: generato una volta, salvato per sempre
    let uuid = localStorage.getItem('ml_device_uuid');
    if (!uuid) {
      const buf = CRYPTO.generateSalt();
      uuid = CRYPTO.hex(buf) + CRYPTO.hex(CRYPTO.generateSalt());
      localStorage.setItem('ml_device_uuid', uuid);
      console.log('[auth] nuovo device UUID:', uuid.slice(0, 8) + '...');
    }

    // Caratteristiche stabili del device
    // Nota: usiamo solo valori che NON cambiano con gli aggiornamenti
    const traits = [
      uuid,
      String(screen.width),
      String(screen.height),
      String(screen.colorDepth),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      String(navigator.hardwareConcurrency || 0),
    ].join('::');

    const hash = await CRYPTO.sha256(traits);
    _deviceId  = CRYPTO.hex(hash);
    return _deviceId;
  }

  // ─── FILE UTENTE ─────────────────────────────────────
  function readUserFile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw);
      // Accetta solo il formato corrente
      if (u.v !== FORMAT_VER) {
        console.warn('[auth] formato file utente non riconosciuto:', u.v);
        return null;
      }
      return u;
    } catch (e) {
      console.error('[auth] errore lettura file utente:', e);
      return null;
    }
  }

  function writeUserFile(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[auth] errore scrittura file utente:', e);
      throw e;
    }
  }

  // ─── API PUBBLICA ─────────────────────────────────────

  // Esiste un utente configurato su questo device?
  function isConfigured() {
    const u = readUserFile();
    return !!(u && u.v === FORMAT_VER && u.encSeed && u.salt);
  }

  // Il file utente appartiene a questo device?
  // false → device diverso → serve recovery con 12 parole
  async function isCurrentDevice() {
    const u = readUserFile();
    if (!u) return false;
    const deviceId = await getDeviceId();
    return u.deviceId === deviceId;
  }

  // ─── SETUP PRIMO AVVIO ───────────────────────────────
  // Crea l'utente su questo device.
  // Restituisce le 12 parole di backup.
  async function setup(pin) {
    console.log('[auth] setup primo avvio...');

    const deviceId = await getDeviceId();
    const iter     = await CRYPTO.calibrate();

    // 1. Genera seed casuale — la chiave master di tutto
    const seed  = CRYPTO.generateSeed();
    const words = CRYPTO.seedToWords(seed);

    // 2. Genera sale per PBKDF2
    const salt = CRYPTO.generateSalt();

    // 3. Deriva chiave dal PIN + device
    const pinKey = await CRYPTO.deriveKeyFromPin(pin, deviceId, salt, iter);

    // 4. Cifra il seed con la chiave PIN
    const encSeed = await CRYPTO.aesEncrypt(seed, pinKey);

    // 5. Check rapido per verifica PIN istantanea
    const pinCheck = await CRYPTO.pinCheck(pin, deviceId, salt);

    // 6. Genera userId anonimo univoco
    const userIdBytes = CRYPTO.generateSalt();
    const userId      = CRYPTO.hex(userIdBytes);

    // 7. Attiva la chiave dati (usata da db.js)
    AUTH._activeKey = await CRYPTO.deriveDataKey(seed, 'data');

    // 8. Scrivi file utente
    writeUserFile({
      v:              FORMAT_VER,
      userId,
      deviceId,
      created:        new Date().toISOString().split('T')[0],
      salt:           CRYPTO.hex(salt),
      iter,
      pinCheck,
      encSeed,
      backupVerified: false,
    });

    console.log('[auth] setup OK — userId:', userId.slice(0, 8) + '...');
    return words;
  }

  // ─── UNLOCK CON PIN ──────────────────────────────────
  // Restituisce:
  //   true           → accesso concesso
  //   false          → PIN sbagliato
  //   'wrong_device' → device diverso, serve recovery
  async function unlock(pin) {
    try {
      const u = readUserFile();
      if (!u) {
        console.warn('[auth] nessun file utente');
        return false;
      }

      const deviceId = await getDeviceId();

      // Verifica device
      if (u.deviceId !== deviceId) {
        console.warn('[auth] device diverso');
        return 'wrong_device';
      }

      const salt = CRYPTO.unhex(u.salt);

      // 1. Check rapido PIN (SHA-256, <5ms)
      //    Se il PIN è sbagliato, risponde subito senza fare PBKDF2
      const check = await CRYPTO.pinCheck(pin, deviceId, salt);
      if (check !== u.pinCheck) {
        console.log('[auth] PIN errato (check rapido)');
        return false;
      }

      // 2. PIN corretto → decifra seed (PBKDF2, ~300ms)
      const pinKey  = await CRYPTO.deriveKeyFromPin(pin, deviceId, salt, u.iter);
      const seedBuf = await CRYPTO.aesDecrypt(u.encSeed, pinKey);

      // 3. Attiva chiave dati
      AUTH._activeKey = await CRYPTO.deriveDataKey(seedBuf, 'data');

      console.log('[auth] unlock OK');
      return true;

    } catch (e) {
      console.error('[auth] unlock error:', e);
      return false;
    }
  }

  // ─── RECOVERY CON 12 PAROLE ──────────────────────────
  // Verifica le 12 parole e restituisce { seed } se valide.
  // Usato sia per "dimenticato PIN" che per "nuovo device".
  async function recoverWithWords(words) {
    try {
      const seed = CRYPTO.wordsToSeed(words);
      if (!seed) {
        console.warn('[auth] recovery: parole non valide');
        return null;
      }

      // Attiva provvisoriamente la chiave dati
      // (sarà confermata dopo il reset del PIN)
      const key = await CRYPTO.deriveDataKey(seed, 'data');

      console.log('[auth] recovery: parole verificate');
      return { seed, key };

    } catch (e) {
      console.error('[auth] recovery error:', e);
      return null;
    }
  }

  // ─── MIGRAZIONE SU NUOVO DEVICE ──────────────────────
  // Dopo recovery con 12 parole: riconfigura l'utente
  // su questo device con un nuovo PIN.
  // Mantiene userId originale (identità utente invariata).
  async function migrateToDevice(pin, seed) {
    console.log('[auth] migrazione su nuovo device...');

    const deviceId = await getDeviceId();
    const iter     = await CRYPTO.calibrate();
    const salt     = CRYPTO.generateSalt();
    const pinKey   = await CRYPTO.deriveKeyFromPin(pin, deviceId, salt, iter);
    const encSeed  = await CRYPTO.aesEncrypt(seed, pinKey);
    const pinCheck = await CRYPTO.pinCheck(pin, deviceId, salt);

    // Mantieni userId originale se esiste
    const existing = readUserFile();
    const userId   = existing?.userId
      || CRYPTO.hex(CRYPTO.generateSalt());

    // Attiva chiave dati
    AUTH._activeKey = await CRYPTO.deriveDataKey(seed, 'data');

    writeUserFile({
      v:              FORMAT_VER,
      userId,
      deviceId,
      created:        existing?.created || new Date().toISOString().split('T')[0],
      migratedAt:     new Date().toISOString().split('T')[0],
      salt:           CRYPTO.hex(salt),
      iter,
      pinCheck,
      encSeed,
      backupVerified: true, // ha già le 12 parole
    });

    console.log('[auth] migrazione OK');
  }

  // ─── SEGNA BACKUP VERIFICATO ─────────────────────────
  function markBackupVerified() {
    const u = readUserFile();
    if (!u) return;
    u.backupVerified = true;
    writeUserFile(u);
    console.log('[auth] backup verificato');
  }

  // ─── INFO UTENTE (solo dati non sensibili) ────────────
  function getUserInfo() {
    const u = readUserFile();
    if (!u) return null;
    return {
      userId:         u.userId?.slice(0, 8) + '...',
      created:        u.created,
      backupVerified: u.backupVerified,
      migratedAt:     u.migratedAt || null,
    };
  }

  // ─── BLOCCA SESSIONE ─────────────────────────────────
  function lock() {
    AUTH._activeKey = null;
    _deviceId       = null; // ricalcola al prossimo accesso
    console.log('[auth] sessione terminata');
  }

  // ─── RESET COMPLETO ──────────────────────────────────
  // ATTENZIONE: cancella tutto. Usare solo come ultima risorsa.
  function fullReset() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('ml_device_uuid');
    localStorage.removeItem('ml_pbkdf2_iter');
    AUTH._activeKey = null;
    _deviceId       = null;
    console.log('[auth] reset completo eseguito');
  }

  // ─── CHIAVE DATI ATTIVA ──────────────────────────────
  // Usata da db.js per cifrare/decifrare i dati dell'app.
  // null = sessione bloccata.
  // Non esposta direttamente — db.js la legge via getKey()
  let _activeKey = null;

  function getKey() {
    return _activeKey;
  }

  // Espone la chiave tramite funzione (non come proprietà)
  // per evitare accessi accidentali dall'esterno
  return {
    isConfigured,
    isCurrentDevice,
    setup,
    unlock,
    recoverWithWords,
    migrateToDevice,
    markBackupVerified,
    getUserInfo,
    lock,
    fullReset,
    getKey,
    // _activeKey è interno, ma db.js ne ha bisogno
    // lo esponiamo con underscore come convenzione "interno"
    get _activeKey() { return _activeKey; },
    set _activeKey(v) { _activeKey = v; },
  };

})();

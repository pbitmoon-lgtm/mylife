// ═══════════════════════════════════════════════════════
// My Life — hardware.js
// Gestisce l'autenticazione e la derivazione dell'entropia.
//
// Strategia:
//   1. WebAuthn PRF (biometria/chip hardware) — preferito
//   2. PIN + SHA-256 — fallback per device non supportati
//
// Non tocca mai i dati applicativi.
// Non conosce AES, IndexedDB, o la UI.
// Emette un solo evento: AUTH_SUCCESS_PRF { rawBytes }
// ═══════════════════════════════════════════════════════

import State from './state.js';

const Hardware = (() => {

  // Wordlist per recovery (256 parole, sottoinsieme BIP39)
  const WL = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];

  // Storage key per il file utente
  const USER_KEY = 'ml_user_v4';

  // ─── DEVICE ID ────────────────────────────────────────
  // UUID stabile: generato una volta, salvato per sempre
  // Non usa user agent (cambia con aggiornamenti)
  async function getDeviceId() {
    let uuid = localStorage.getItem('ml_uuid');
    if (!uuid) {
      const buf = crypto.getRandomValues(new Uint8Array(16));
      uuid = Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem('ml_uuid', uuid);
    }
    const traits = [
      uuid,
      String(screen.width), String(screen.height),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
    ].join('::');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ─── USER FILE ────────────────────────────────────────
  function readUser() {
    try {
      const r = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      return (r && r.v === '4') ? r : null;
    } catch { return null; }
  }

  function writeUser(data) {
    localStorage.setItem(USER_KEY, JSON.stringify({ ...data, v: '4' }));
  }

  // ─── WEBAUTHN PRF ─────────────────────────────────────
  // Usa il chip hardware del dispositivo per derivare entropia.
  // L'utente si autentica con biometria/PIN del telefono.
  // Il browser NON espone mai la chiave privata.
  function isPRFSupported() {
    return !!(window.PublicKeyCredential &&
      PublicKeyCredential.isConditionalMediationAvailable);
  }

  async function registerPRF(salt) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'My Life', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'mylife_user',
          displayName: 'My Life User'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'required'
        },
        extensions: {
          prf: { eval: { first: salt } }
        }
      }
    });

    const prf = cred.getClientExtensionResults().prf;
    if (!prf?.results?.first) throw new Error('PRF non supportato su questo device');

    return {
      credentialId: Array.from(new Uint8Array(cred.rawId))
        .map(b => b.toString(16).padStart(2,'0')).join(''),
      rawBytes: new Uint8Array(prf.results.first)
    };
  }

  async function authenticatePRF(credentialId, salt) {
    const credIdBytes = new Uint8Array(
      credentialId.match(/.{2}/g).map(b => parseInt(b, 16))
    );
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: credIdBytes }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } }
      }
    });

    const prf = assertion.getClientExtensionResults().prf;
    if (!prf?.results?.first) throw new Error('PRF fallito');
    return new Uint8Array(prf.results.first);
  }

  // ─── FALLBACK PIN ─────────────────────────────────────
  async function pinToBytes(pin, deviceId) {
    const material = `mylife:v4:${pin}:${deviceId}`;
    const hash = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(material));
    return new Uint8Array(hash);
  }

  // ─── VERIFICA PIN ─────────────────────────────────────
  // Replica la derivazione HKDF di crypto.js per verificare
  // il PIN PRIMA di emettere AUTH_SUCCESS_PRF.
  // Senza questa verifica, qualsiasi PIN è accettato.
  async function verifyPin(pin, deviceId, encryptedSeed) {
    try {
      const rawBytes = await pinToBytes(pin, deviceId);
      // Replica esatta di crypto.js deriveMasterKey
      const km = await crypto.subtle.importKey(
        'raw', rawBytes, { name:'HKDF' }, false, ['deriveKey']
      );
      const key = await crypto.subtle.deriveKey(
        { name:'HKDF', hash:'SHA-256',
          salt: new TextEncoder().encode('MyLife:domain:v4'),
          info: new TextEncoder().encode('MyLife Master Key v4') },
        km, { name:'AES-GCM', length:256 }, false, ['decrypt']
      );
      // Tenta decifratura del seed — se fallisce il PIN è sbagliato
      const buf = new Uint8Array(encryptedSeed);
      const iv  = buf.slice(0, 12);
      const ct  = buf.slice(12);
      await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, ct);
      return true; // PIN corretto
    } catch {
      return false; // PIN errato — AES-GCM authentication failed
    }
  }

  // ─── SEED ↔ PAROLE ────────────────────────────────────
  function seedToWords(seed) {
    return Array.from(seed).slice(0,12).map(b => WL[b % WL.length]);
  }

  function wordsToSeed(words) {
    if (!words || words.length !== 12) return null;
    const clean = words.map(w => (w||'').toLowerCase().trim());
    const idxs  = clean.map(w => WL.indexOf(w));
    if (idxs.some(i => i < 0)) return null;
    const seed = new Uint8Array(32);
    idxs.forEach((v,i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) seed[i] = (seed[i-12] ^ seed[i-6] ^ 0x5A) % 256;
    return seed;
  }

  // ─── API PUBBLICA ─────────────────────────────────────

  // Verifica lo stato dell'utente e decide il flusso di boot
  async function checkAndBoot() {
    const user     = readUser();
    const deviceId = await getDeviceId();

    if (!user) {
      // Prima volta — mostra setup
      State.dispatch('AUTH_NEED_SETUP', { deviceId });
      return;
    }

    if (user.deviceId !== deviceId) {
      // Device diverso — mostra recovery
      State.dispatch('AUTH_NEED_RECOVERY', { reason: 'new_device' });
      return;
    }

    // Utente e device riconosciuti — mostra lock screen
    State.dispatch('AUTH_NEED_PIN', {
      hasPRF: !!user.credentialId,
      userId: user.userId
    });
  }

  // Setup primo avvio con PIN (fallback universale)
  async function setupWithPin(pin) {
    const deviceId = await getDeviceId();
    const rawBytes = await pinToBytes(pin, deviceId);
    const seed     = crypto.getRandomValues(new Uint8Array(32));
    const words    = seedToWords(seed);

    // Salva user SENZA seed in chiaro.
    // Il seed viene cifrato da crypto.js dopo CRYPTO_KEY_DERIVED
    // e riscritto da persistSeed() — mai in chiaro su disco.
    writeUser({
      userId:    Array.from(crypto.getRandomValues(new Uint8Array(8)))
                   .map(b=>b.toString(16).padStart(2,'0')).join(''),
      deviceId,
      created:   new Date().toISOString().split('T')[0],
      authMode:  'pin',
      backupVerified: false,
    });

    State.dispatch('AUTH_SUCCESS_PRF', { rawBytes, seed, words, isSetup: true });
  }

  // Unlock con PIN — verifica PRIMA di procedere
  async function unlockWithPin(pin) {
    const user     = readUser();
    const deviceId = await getDeviceId();

    if (!user) {
      State.dispatch('AUTH_FAILED', { reason: 'no_user' });
      return;
    }

    // Se abbiamo encryptedSeed, verifica il PIN crittograficamente
    if (user.encryptedSeed) {
      const ok = await verifyPin(pin, deviceId, user.encryptedSeed);
      if (!ok) {
        State.dispatch('AUTH_FAILED', { reason: 'wrong_pin' });
        return;
      }
    }

    // PIN verificato (o nessun seed da verificare — primo unlock dopo setup)
    const rawBytes = await pinToBytes(pin, deviceId);
    State.dispatch('AUTH_SUCCESS_PRF', { rawBytes, isSetup: false });
  }

  // Recovery con 12 parole
  async function recoverWithWords(words) {
    const seed = wordsToSeed(words);
    if (!seed) {
      State.dispatch('AUTH_FAILED', { reason: 'invalid_words' });
      return;
    }
    State.dispatch('AUTH_RECOVERY_VERIFIED', { seed, words });
  }

  // Setup dopo recovery (nuovo device, nuovo PIN)
  async function migrateWithPin(pin, seed) {
    const deviceId = await getDeviceId();
    const rawBytes = await pinToBytes(pin, deviceId);
    const existing = readUser();

    writeUser({
      userId:    existing?.userId || Array.from(crypto.getRandomValues(new Uint8Array(8)))
                   .map(b=>b.toString(16).padStart(2,'0')).join(''),
      deviceId,
      created:   existing?.created || new Date().toISOString().split('T')[0],
      migratedAt: new Date().toISOString().split('T')[0],
      authMode:  'pin',
      backupVerified: true,
    });

    State.dispatch('AUTH_SUCCESS_PRF', { rawBytes, seed, isSetup: false });
  }

  // Salva il seed cifrato nel file utente (chiamato dopo CRYPTO_KEY_DERIVED)
  function persistSeed(encryptedSeed) {
    const user = readUser();
    if (user) {
      user.encryptedSeed = encryptedSeed;
      delete user.seed; // rimuovi il seed in chiaro
      writeUser(user);
    }
  }

  function markBackupVerified() {
    const user = readUser();
    if (user) { user.backupVerified = true; writeUser(user); }
  }

  function readUserPublic() {
    const u = readUser();
    if (!u) return null;
    return { userId: u.userId, created: u.created, backupVerified: u.backupVerified };
  }

  function fullReset() {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('ml_uuid');
    localStorage.removeItem('ml_settings');
  }

  return {
    checkAndBoot,
    setupWithPin,
    unlockWithPin,
    recoverWithWords,
    migrateWithPin,
    persistSeed,
    markBackupVerified,
    readUserPublic,
    fullReset,
    seedToWords,
    wordsToSeed,
  };

})();

export default Hardware;

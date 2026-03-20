// ═══════════════════════════════════════════════════════
// My Life — crypto.js
// Versione: 1.0.0 DEFINITIVA
//
// RESPONSABILITÀ: algoritmi crittografici puri.
// Questo file NON sa nulla di:
//   - utenti, PIN, device, storage, rete
// Questo file FA solo:
//   - cifrare e decifrare dati (AES-256-GCM)
//   - derivare chiavi (PBKDF2, HKDF)
//   - convertire seed ↔ 12 parole
//   - utilità hex
//
// REGOLA: questo file non cambia mai formato.
// Aggiunte future = nuove funzioni, mai modifica
// di funzioni esistenti.
// ═══════════════════════════════════════════════════════

const CRYPTO = (() => {

  // ─── WORDLIST (256 parole, sottoinsieme BIP39) ──────
  const WL = [
    'abandon','ability','able','about','above','absent',
    'absorb','abstract','absurd','abuse','access','accident',
    'account','accuse','achieve','acid','acoustic','acquire',
    'across','act','action','actor','actress','actual',
    'adapt','add','addict','address','adjust','admit',
    'adult','advance','advice','aerobic','afford','afraid',
    'again','age','agent','agree','ahead','aim',
    'air','airport','aisle','alarm','album','alcohol',
    'alert','alien','all','alley','allow','almost',
    'alone','alpha','already','also','alter','always',
    'amateur','amazing','among','amount','amused','analyst',
    'anchor','ancient','anger','angle','angry','animal',
    'ankle','announce','annual','another','answer','antenna',
    'antique','anxiety','any','apart','apology','appear',
    'apple','approve','april','arch','arctic','area',
    'arena','argue','arm','armor','army','around',
    'arrange','arrest','arrive','arrow','art','artefact',
    'artist','artwork','ask','aspect','assault','asset',
    'assist','assume','asthma','athlete','atom','attack',
    'attend','attitude','attract','auction','audit','august',
    'aunt','author','auto','autumn','average','avocado',
    'avoid','awake','aware','away','awesome','awful',
    'awkward','axis','baby','balance','bamboo','banana',
    'banner','bar','barely','bargain','barrel','base',
    'basic','basket','battle','beach','beauty','because',
    'become','beef','before','begin','behave','behind',
    'believe','below','belt','bench','benefit','best',
    'betray','better','between','beyond','bicycle','bid',
    'bike','bind','biology','bird','birth','bitter',
    'black','blade','blame','blanket','blast','bleak',
    'bless','blind','blood','blossom','blouse','blue',
    'blur','blush','board','boat','body','boil',
    'bomb','bone','book','boost','border','boring',
    'borrow','boss','bottom','bounce','box','boy',
    'bracket','brain','brand','brave','breeze','brick',
    'bridge','brief','bright','bring','brisk','broccoli',
    'broken','bronze','broom','brother','brown','brush',
    'bubble','buddy','budget','buffalo','build','bulb',
    'bulk','bullet','bundle','bunker','burden','burger',
    'burst','bus','business','busy','butter','buyer',
  ];

  // ─── COSTANTI ────────────────────────────────────────
  const AES_ALGO    = 'AES-GCM';
  const AES_LENGTH  = 256;
  const HASH_ALGO   = 'SHA-256';
  const PBKDF2_HASH = 'SHA-256';
  const HKDF_HASH   = 'SHA-256';
  const IV_LENGTH   = 12;  // byte, standard per AES-GCM
  const SALT_LENGTH = 16;  // byte

  // ─── CALIBRAZIONE PBKDF2 ─────────────────────────────
  // Misura la velocità del device e calcola le iterazioni
  // per raggiungere ~300ms. Eseguito una volta sola.
  // Risultato cachato, non ricalcolato mai.
  async function calibrate() {
    const CACHE_KEY = 'ml_pbkdf2_iter';
    const cached    = parseInt(localStorage.getItem(CACHE_KEY) || '0');
    if (cached >= 1000) {
      console.log(`[crypto] iter cachate: ${cached}`);
      return cached;
    }

    // Misura 1.000 iterazioni su questo device
    const testSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const testKey  = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('calibration_test'),
      'PBKDF2', false, ['deriveKey']
    );

    const t0 = performance.now();
    await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: testSalt, iterations: 1000, hash: PBKDF2_HASH },
      testKey,
      { name: AES_ALGO, length: AES_LENGTH },
      false, ['encrypt']
    );
    const ms1000 = performance.now() - t0;

    // Calcola iter per ~300ms, con limiti di sicurezza
    // Min 5.000 (sicurezza minima)
    // Max 200.000 (evita freeze su device lenti)
    const TARGET_MS = 300;
    const iter = Math.max(
      5000,
      Math.min(200000, Math.round((TARGET_MS / ms1000) * 1000))
    );

    localStorage.setItem(CACHE_KEY, String(iter));
    console.log(
      `[crypto] calibrazione: 1k iter = ${ms1000.toFixed(1)}ms` +
      ` → target = ${iter} iter (~${Math.round(iter / 1000 * ms1000)}ms)`
    );
    return iter;
  }

  // ─── DERIVAZIONE CHIAVE PIN ──────────────────────────
  // Deriva chiave AES da: PIN + deviceId + salt + iter
  // La chiave dipende SIA dal PIN che dal device.
  // Stesso PIN su device diverso = chiave diversa = accesso negato.
  async function deriveKeyFromPin(pin, deviceId, salt, iter) {
    // Il materiale include il deviceId — lega la chiave al device
    const material = `mylife:pin:${pin}:${deviceId}`;
    const base = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(material),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: PBKDF2_HASH },
      base,
      { name: AES_ALGO, length: AES_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ─── CHECK RAPIDO PIN ─────────────────────────────────
  // SHA-256 istantaneo per verificare se il PIN è corretto
  // PRIMA di fare PBKDF2 (che è lento).
  // Se il check fallisce → PIN sbagliato → risposta in <5ms
  // Se il check passa → fai PBKDF2 → ~300ms
  async function pinCheck(pin, deviceId, salt) {
    const data = new TextEncoder().encode(
      `mylife:check:${pin}:${deviceId}:${hex(salt)}`
    );
    const hash = await crypto.subtle.digest(HASH_ALGO, data);
    return hex(new Uint8Array(hash));
  }

  // ─── CHIAVE DATI (HKDF) ──────────────────────────────
  // Deriva la chiave per cifrare i dati dell'app dal seed.
  // path = 'data'   → chiave dati app
  // path = 'nostr'  → keypair Nostr (M3)
  // path = 'wallet' → wallet Base (M3.2)
  async function deriveDataKey(seed, path = 'data') {
    const base = await crypto.subtle.importKey(
      'raw', seed, 'HKDF', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: HKDF_HASH,
        salt: new TextEncoder().encode('mylife:v1'),
        info: new TextEncoder().encode(`mylife:${path}:key`),
      },
      base,
      { name: AES_ALGO, length: AES_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ─── AES-256-GCM ENCRYPT ─────────────────────────────
  // Cifra dati (Uint8Array o stringa JSON) con una chiave AES.
  // Restituisce { iv: hex, d: hex }
  async function aesEncrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ct = await crypto.subtle.encrypt(
      { name: AES_ALGO, iv },
      key,
      data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data))
    );
    return { iv: hex(iv), d: hex(new Uint8Array(ct)) };
  }

  // ─── AES-256-GCM DECRYPT ─────────────────────────────
  // Decifra un blob { iv, d } con una chiave AES.
  // Restituisce Uint8Array
  async function aesDecrypt(blob, key) {
    if (!blob || !blob.iv || !blob.d) throw new Error('[crypto] blob non valido');
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: AES_ALGO, iv: unhex(blob.iv) },
        key,
        unhex(blob.d)
      )
    );
  }

  // ─── CIFRA OGGETTO APP ────────────────────────────────
  // Cifra un qualsiasi oggetto JS per lo storage.
  // Aggiunge il flag _ml:true per riconoscerlo.
  async function encryptObject(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ct = await crypto.subtle.encrypt(
      { name: AES_ALGO, iv },
      key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return { _ml: true, iv: hex(iv), d: hex(new Uint8Array(ct)) };
  }

  // ─── DECIFRA OGGETTO APP ─────────────────────────────
  // Se il blob non è cifrato (_ml assente), lo passa diretto.
  // Compatibilità con dati legacy non cifrati.
  async function decryptObject(blob, key) {
    if (!blob || !blob._ml) return blob; // non cifrato, passa diretto
    const raw = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: unhex(blob.iv) },
      key,
      unhex(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  }

  // ─── SEED ↔ PAROLE ────────────────────────────────────
  // Converte seed (32 byte) in 12 parole leggibili.
  // Usa i primi 12 byte del seed come indici nella wordlist.
  function seedToWords(seed) {
    if (!(seed instanceof Uint8Array) || seed.length < 12) {
      throw new Error('[crypto] seed non valido');
    }
    return Array.from(seed).slice(0, 12).map(b => WL[b % WL.length]);
  }

  // Converte 12 parole in seed (32 byte, deterministico).
  // Restituisce null se le parole non sono valide.
  function wordsToSeed(words) {
    if (!words || words.length !== 12) return null;

    const clean = words.map(w => (w || '').toLowerCase().trim());
    const idxs  = clean.map(w => WL.indexOf(w));

    // Verifica che tutte le parole siano nella wordlist
    if (idxs.some(i => i < 0)) {
      console.warn('[crypto] parole non riconosciute:', 
        clean.filter(w => WL.indexOf(w) < 0));
      return null;
    }

    // Costruisce seed di 32 byte:
    // - byte 0-11: indici delle parole (% 256)
    // - byte 12-31: derivati deterministicamente
    const seed = new Uint8Array(32);
    idxs.forEach((v, i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) {
      seed[i] = (seed[i - 12] ^ seed[i - 6] ^ 0x5A) % 256;
    }
    return seed;
  }

  // ─── GENERA SEED CASUALE ─────────────────────────────
  function generateSeed() {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  // ─── GENERA SALT ─────────────────────────────────────
  function generateSalt() {
    return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  }

  // ─── UTILITÀ HEX ─────────────────────────────────────
  function hex(buf) {
    return Array.from(buf)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function unhex(str) {
    if (!str || str.length % 2 !== 0) return new Uint8Array(0);
    return new Uint8Array(
      str.match(/.{2}/g).map(b => parseInt(b, 16))
    );
  }

  // ─── SHA-256 GENERICO ────────────────────────────────
  async function sha256(input) {
    const data = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input;
    const hash = await crypto.subtle.digest(HASH_ALGO, data);
    return new Uint8Array(hash);
  }

  // ─── API PUBBLICA ────────────────────────────────────
  return {
    calibrate,
    deriveKeyFromPin,
    pinCheck,
    deriveDataKey,
    aesEncrypt,
    aesDecrypt,
    encryptObject,
    decryptObject,
    seedToWords,
    wordsToSeed,
    generateSeed,
    generateSalt,
    sha256,
    hex,
    unhex,
  };

})();

// ═══════════════════════════════════════════════
// My Life — crypto.js  DEFINITIVO
// Autenticazione: PIN + Device fingerprint
// La chiave = PBKDF2(PIN + deviceId, salt, iter)
// Stesso PIN su altro telefono = accesso negato
// ═══════════════════════════════════════════════

const WL = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];

const CE = {

  key: null,      // chiave dati attiva (null = bloccato)
  deviceId: null, // fingerprint del device corrente

  // ─────────────────────────────────────────────
  // DEVICE FINGERPRINT
  // Costruisce un ID univoco per questo device.
  // Combina caratteristiche stabili + UUID generato
  // una volta sola e salvato nel device.
  // ─────────────────────────────────────────────
  async getDeviceId() {
    if (this.deviceId) return this.deviceId;

    // UUID stabile salvato nel device (generato al primo avvio)
    let uuid = localStorage.getItem('ml_device_uuid');
    if (!uuid) {
      // Genera UUID casuale legato a questo browser/device
      const buf = crypto.getRandomValues(new Uint8Array(16));
      uuid = Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem('ml_device_uuid', uuid);
      console.log('[CE] nuovo device UUID generato:', uuid.slice(0,8) + '...');
    }

    // Caratteristiche stabili del device
    const traits = [
      uuid,
      navigator.userAgent,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform || 'unknown'
    ].join('|');

    // Hash SHA-256 di tutto
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(traits)
    );
    this.deviceId = this._hex(new Uint8Array(hash));
    console.log('[CE] deviceId:', this.deviceId.slice(0,16) + '...');
    return this.deviceId;
  },

  // ─────────────────────────────────────────────
  // USER FILE — struttura dati salvata nel device
  //
  // {
  //   v:          "final"           — versione (mai cambia)
  //   deviceId:   "abc..."          — fingerprint device
  //   userId:     "xyz..."          — ID utente univoco
  //   created:    "2026-03-19"      — data creazione
  //   salt:       "hex..."          — sale per PBKDF2
  //   iter:       15000             — iterazioni calibrate
  //   pinCheck:   "hex..."          — check rapido PIN
  //   encSeed:    { iv, d }         — seed cifrato
  //   backupVerified: true/false    — 12 parole confermate
  // }
  // ─────────────────────────────────────────────

  // Legge il file utente dal localStorage
  _readUserFile() {
    try {
      const raw = localStorage.getItem('ml_user');
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (u.v !== 'final') return null; // versione non riconosciuta
      return u;
    } catch { return null; }
  },

  // Scrive il file utente nel localStorage
  _writeUserFile(data) {
    localStorage.setItem('ml_user', JSON.stringify(data));
  },

  // ─────────────────────────────────────────────
  // ok() — esiste un utente configurato?
  // ─────────────────────────────────────────────
  ok() {
    const u = this._readUserFile();
    return !!(u && u.v === 'final' && u.deviceId && u.encSeed);
  },

  // ─────────────────────────────────────────────
  // sameDevice() — il file utente è di questo device?
  // Se false → serve recovery con 12 parole
  // ─────────────────────────────────────────────
  async sameDevice() {
    const u = this._readUserFile();
    if (!u) return false;
    const currentDeviceId = await this.getDeviceId();
    return u.deviceId === currentDeviceId;
  },

  // ─────────────────────────────────────────────
  // calibrate() — misura velocità PBKDF2 sul device
  // Eseguito una sola volta, risultato cachato
  // ─────────────────────────────────────────────
  async calibrate() {
    const cached = parseInt(localStorage.getItem('ml_iter') || '0');
    if (cached >= 5000) return cached;

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('test'), 'PBKDF2', false, ['deriveKey']
    );
    const t0 = performance.now();
    await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const ms = performance.now() - t0;

    // Target: ~300ms. Min: 5000. Max: 100000.
    const iter = Math.max(5000, Math.min(100000, Math.round(300 / ms * 1000)));
    localStorage.setItem('ml_iter', String(iter));
    console.log(`[CE] calibrazione: 1k iter=${ms.toFixed(0)}ms → iter=${iter}`);
    return iter;
  },

  // ─────────────────────────────────────────────
  // setup() — primo avvio: crea utente su questo device
  // ─────────────────────────────────────────────
  async setup(pin) {
    const deviceId = await this.getDeviceId();
    const iter     = await this.calibrate();

    // Genera seed casuale (32 byte = chiave master di tutto)
    const seed  = crypto.getRandomValues(new Uint8Array(32));
    const words = this._seedToWords(seed);

    // Deriva chiave da PIN + deviceId (doppia protezione)
    const salt   = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await this._deriveKey(pin, deviceId, salt, iter);

    // Cifra il seed
    const encSeed = await this._encrypt(seed, pinKey);

    // Check rapido per verifica PIN istantanea
    const pinCheck = await this._pinCheck(pin, deviceId, salt);

    // Genera userId univoco
    const userIdBuf = crypto.getRandomValues(new Uint8Array(16));
    const userId    = this._hex(userIdBuf);

    // Attiva chiave dati
    this.key = await this._dataKey(seed);

    // Scrivi file utente
    this._writeUserFile({
      v:               'final',
      userId,
      deviceId,
      created:         new Date().toISOString().split('T')[0],
      salt:            this._hex(salt),
      iter,
      pinCheck,
      encSeed,
      backupVerified:  false
    });

    console.log('[CE] setup OK — userId:', userId.slice(0,8) + '...');
    return words;
  },

  // ─────────────────────────────────────────────
  // unlock() — sblocca con PIN su device corrente
  // ─────────────────────────────────────────────
  async unlock(pin) {
    try {
      const u = this._readUserFile();
      if (!u) { console.warn('[CE] nessun file utente'); return false; }

      const deviceId = await this.getDeviceId();

      // Verifica che sia il device corretto
      if (u.deviceId !== deviceId) {
        console.warn('[CE] device diverso — serve recovery');
        return 'wrong_device'; // valore speciale
      }

      const salt = this._unhex(u.salt);

      // Check rapido PIN (SHA-256, <5ms)
      const check = await this._pinCheck(pin, deviceId, salt);
      if (check !== u.pinCheck) {
        console.log('[CE] PIN errato');
        return false;
      }

      // PIN corretto → decifra seed (PBKDF2 calibrato)
      const pinKey = await this._deriveKey(pin, deviceId, salt, u.iter);
      const seed   = await this._decrypt(u.encSeed, pinKey);
      this.key     = await this._dataKey(seed);

      console.log('[CE] unlock OK');
      return true;
    } catch (e) {
      console.error('[CE] unlock error:', e);
      return false;
    }
  },

  // ─────────────────────────────────────────────
  // recover() — accesso da nuovo device con 12 parole
  // Restituisce { seed } se valido, null altrimenti
  // ─────────────────────────────────────────────
  async recover(words) {
    try {
      const seed = this._wordsToSeed(words);
      if (!seed) { console.warn('[CE] parole non valide'); return null; }
      // Verifica: prova ad attivare la chiave dati
      const key = await this._dataKey(seed);
      console.log('[CE] recover OK');
      return { seed, key };
    } catch (e) {
      console.error('[CE] recover error:', e);
      return null;
    }
  },

  // ─────────────────────────────────────────────
  // migrate() — sposta utente su nuovo device dopo recovery
  // Crea nuovo file utente per questo device con nuovo PIN
  // ─────────────────────────────────────────────
  async migrate(pin, seed) {
    const deviceId = await this.getDeviceId();
    const iter     = await this.calibrate();
    const salt     = crypto.getRandomValues(new Uint8Array(16));
    const pinKey   = await this._deriveKey(pin, deviceId, salt, iter);
    const encSeed  = await this._encrypt(seed, pinKey);
    const pinCheck = await this._pinCheck(pin, deviceId, salt);

    // Leggi userId esistente se c'è (mantieni identità utente)
    const existing = this._readUserFile();
    const userId   = existing?.userId || this._hex(crypto.getRandomValues(new Uint8Array(16)));

    this.key = await this._dataKey(seed);

    this._writeUserFile({
      v: 'final', userId, deviceId,
      created: existing?.created || new Date().toISOString().split('T')[0],
      migratedAt: new Date().toISOString().split('T')[0],
      salt: this._hex(salt), iter, pinCheck, encSeed,
      backupVerified: true
    });

    console.log('[CE] migrate OK — nuovo device configurato');
  },

  // Segna le 12 parole come verificate
  markBackupVerified() {
    const u = this._readUserFile();
    if (u) { u.backupVerified = true; this._writeUserFile(u); }
  },

  lock() { this.key = null; console.log('[CE] locked'); },

  // ─────────────────────────────────────────────
  // enc() / dec() — cifra/decifra dati app
  // ─────────────────────────────────────────────
  async enc(obj) {
    if (!this.key) throw new Error('[CE] non sbloccato');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, this.key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return { _ml: true, iv: this._hex(iv), d: this._hex(new Uint8Array(ct)) };
  },

  async dec(blob) {
    if (!blob || !blob._ml) return blob;
    if (!this.key) throw new Error('[CE] non sbloccato');
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this._unhex(blob.iv) },
      this.key, this._unhex(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  },

  // ═════════════════════════════════════════════
  // INTERNI
  // ═════════════════════════════════════════════

  // PBKDF2(PIN + deviceId, salt, iter) → chiave AES
  // La chiave dipende SIA dal PIN che dal device
  async _deriveKey(pin, deviceId, salt, iter) {
    const material = pin + ':' + deviceId; // PIN legato al device
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(material), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  // SHA-256 rapido per check PIN — istantaneo
  async _pinCheck(pin, deviceId, salt) {
    const data = new Uint8Array([
      ...new TextEncoder().encode('mylife:check:' + pin + ':' + deviceId),
      ...salt
    ]);
    const h = await crypto.subtle.digest('SHA-256', data);
    return this._hex(new Uint8Array(h));
  },

  // HKDF — deriva chiave dati dal seed
  async _dataKey(seed) {
    const base = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('mylife:data:v1'),
        info: new TextEncoder().encode('data_encryption_key') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  async _encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: this._hex(iv), d: this._hex(new Uint8Array(ct)) };
  },

  async _decrypt(blob, key) {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this._unhex(blob.iv) }, key, this._unhex(blob.d)
    ));
  },

  _seedToWords(seed) {
    return Array.from(seed).slice(0, 12).map(b => WL[b % WL.length]);
  },

  _wordsToSeed(words) {
    if (!words || words.length !== 12) return null;
    const clean = words.map(w => (w || '').toLowerCase().trim());
    const idxs  = clean.map(w => WL.indexOf(w));
    if (idxs.some(i => i < 0)) return null;
    const seed = new Uint8Array(32);
    idxs.forEach((v, i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) seed[i] = seed[i - 12] ^ 0x5A;
    return seed;
  },

  _hex(b)    { return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(''); },
  _unhex(h)  { return new Uint8Array((h.match(/.{2}/g)||[]).map(b => parseInt(b,16))); }

};

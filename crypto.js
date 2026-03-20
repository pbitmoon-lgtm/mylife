// ═══════════════════════════════════════════════
// My Life — crypto.js  v6.0
// AES-256-GCM + PBKDF2 auto-calibrato
// Sicuro su tutti i dispositivi, veloce su tutti
// ═══════════════════════════════════════════════

const WL = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];

const CE = {
  key: null,

  // ── Config valido? ───────────────────────────
  ok() {
    try {
      const c = JSON.parse(localStorage.getItem('ml_crypto') || 'null');
      // Config valido = ha tutti i campi obbligatori
      return !!(c && c.salt && c.enc && c.iter && c.check);
    } catch { return false; }
  },

  // ── Auto-calibra le iterazioni PBKDF2 ────────
  // Misura la velocità del dispositivo e sceglie
  // le iterazioni per raggiungere ~300ms
  // Minimo: 5.000  Massimo: 100.000
  async calibrate() {
    const cached = localStorage.getItem('ml_iter');
    if (cached) return parseInt(cached);

    // Misura 1.000 iterazioni
    const testSalt = crypto.getRandomValues(new Uint8Array(16));
    const testPin  = new TextEncoder().encode('test');
    const base     = await crypto.subtle.importKey('raw', testPin, 'PBKDF2', false, ['deriveKey']);

    const t0 = performance.now();
    await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: testSalt, iterations: 1000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    const ms1000 = performance.now() - t0;

    // Calcola iterazioni per ~300ms
    const target  = 300;
    const iter    = Math.round((target / ms1000) * 1000);
    const clamped = Math.max(5000, Math.min(100000, iter));

    console.log(`[crypto] 1k iter = ${ms1000.toFixed(1)}ms → target iter = ${clamped}`);
    localStorage.setItem('ml_iter', String(clamped));
    return clamped;
  },

  // ── Setup primo avvio ────────────────────────
  async setup(pin) {
    // 1. Calibra le iterazioni per questo dispositivo
    const iter = await this.calibrate();

    // 2. Genera seed casuale (32 byte = chiave master)
    const seed  = crypto.getRandomValues(new Uint8Array(32));
    const words = this.s2w(seed);

    // 3. Deriva chiave dal PIN
    const salt   = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await this._deriveKey(pin, salt, iter);

    // 4. Cifra il seed con la chiave PIN
    const enc = await this._encRaw(seed, pinKey);

    // 5. Check per verifica rapida (evita decifrazione su PIN sbagliato)
    const check = await this._pinCheck(pin, salt);

    // 6. Attiva la chiave dati
    this.key = await this._dataKey(seed);

    // Salva tutto
    localStorage.setItem('ml_crypto', JSON.stringify({
      salt: this.hex(salt), enc, check, iter, v: '6'
    }));

    console.log(`[crypto] setup OK — iter=${iter}`);
    return words;
  },

  // ── Sblocca con PIN ──────────────────────────
  async unlock(pin) {
    try {
      const c = JSON.parse(localStorage.getItem('ml_crypto'));
      if (!c) { console.error('[crypto] no config'); return false; }

      const salt = this.unhex(c.salt);

      // 1. Verifica rapida del PIN (SHA-256, istantanea)
      const check = await this._pinCheck(pin, salt);
      if (check !== c.check) {
        console.log('[crypto] wrong PIN (check failed)');
        return false;
      }

      // 2. PIN corretto → decifra il seed con le iterazioni salvate
      const iter   = c.iter || 10000;
      const pinKey = await this._deriveKey(pin, salt, iter);
      const seed   = await this._decRaw(c.enc, pinKey);
      this.key     = await this._dataKey(seed);

      console.log('[crypto] unlock OK');
      return true;
    } catch (e) {
      console.error('[crypto] unlock error:', e);
      return false;
    }
  },

  // ── Recovery con 12 parole ───────────────────
  async recover(words) {
    try {
      const seed = this.w2s(words);
      if (!seed) { console.error('[crypto] recovery: parole non valide'); return null; }
      const key = await this._dataKey(seed);
      console.log('[crypto] recovery OK');
      return { seed, key };
    } catch (e) {
      console.error('[crypto] recovery error:', e);
      return null;
    }
  },

  // ── Reset PIN dopo recovery ──────────────────
  async resetPin(pin, seed) {
    const iter   = await this.calibrate();
    const salt   = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await this._deriveKey(pin, salt, iter);
    const enc    = await this._encRaw(seed, pinKey);
    const check  = await this._pinCheck(pin, salt);
    localStorage.setItem('ml_crypto', JSON.stringify({
      salt: this.hex(salt), enc, check, iter, v: '6'
    }));
    this.key = await this._dataKey(seed);
    console.log('[crypto] resetPin OK');
  },

  // ── Cifra oggetto JS ─────────────────────────
  async enc(obj) {
    if (!this.key) throw new Error('CE not unlocked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, this.key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return { _ml: true, iv: this.hex(iv), d: this.hex(new Uint8Array(ct)) };
  },

  // ── Decifra blob ─────────────────────────────
  async dec(blob) {
    if (!blob || !blob._ml) return blob; // non cifrato
    if (!this.key) throw new Error('CE not unlocked');
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.unhex(blob.iv) },
      this.key, this.unhex(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  },

  lock() { this.key = null; },

  // ── Interni ──────────────────────────────────

  // PBKDF2 con iter calibrate — sicuro e veloce
  async _deriveKey(pin, salt, iter) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  // Check rapido del PIN — SHA-256 semplice, istantaneo
  // Usato solo per evitare di fare PBKDF2 su PIN sbagliati
  async _pinCheck(pin, salt) {
    const data = new Uint8Array([...new TextEncoder().encode('check:' + pin), ...salt]);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.hex(new Uint8Array(hash)).slice(0, 32);
  },

  // Chiave dati derivata dal seed via HKDF
  async _dataKey(seed) {
    const base = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife_v6'),
        info: new TextEncoder().encode('data_key') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  async _encRaw(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: this.hex(iv), d: this.hex(new Uint8Array(ct)) };
  },

  async _decRaw(blob, key) {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.unhex(blob.iv) }, key, this.unhex(blob.d)
      )
    );
  },

  // Seed → 12 parole
  s2w(seed) {
    return Array.from(seed).slice(0, 12).map(b => WL[b % WL.length]);
  },

  // 12 parole → seed (32 byte, deterministico)
  w2s(words) {
    if (!words || words.length !== 12) return null;
    const clean = words.map(w => (w || '').toLowerCase().trim());
    const idxs  = clean.map(w => WL.indexOf(w));
    if (idxs.some(i => i < 0)) return null;
    // Seed: 12 byte dalle parole + 20 byte derivati (XOR pattern)
    const seed = new Uint8Array(32);
    idxs.forEach((v, i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) seed[i] = seed[i - 12] ^ 0xA5;
    return seed;
  },

  hex(b) {
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  },
  unhex(h) {
    return new Uint8Array((h.match(/.{2}/g) || []).map(b => parseInt(b, 16)));
  }
};

// ═══════════════════════════════════════════════
// My Life — crypto.js  v4.0
// M2.0 · Cifratura AES-256-GCM + PIN + Recovery
// ═══════════════════════════════════════════════

const WL=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];

const CE = {
  key: null,

  ok() {
    try {
      const c = JSON.parse(localStorage.getItem('ml_crypto') || 'null');
      return !!(c && c.v === '4' && c.salt && c.enc);
    } catch { return false; }
  },

  async setup(pin) {
    const seed = crypto.getRandomValues(new Uint8Array(16));
    const words = this.s2w(seed);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pk = await this._pinKey(pin, salt);
    const enc = await this._encRaw(seed, pk);
    this.key = await this._dataKey(seed);
    localStorage.setItem('ml_crypto', JSON.stringify({
      salt: this.hex(salt), enc, v: '4'
    }));
    return words;
  },

  async unlock(pin) {
    try {
      const c = JSON.parse(localStorage.getItem('ml_crypto'));
      if (!c) return false;
      const pk = await this._pinKey(pin, this.unhex(c.salt));
      const seed = await this._decRaw(c.enc, pk);
      this.key = await this._dataKey(seed);
      return true;
    } catch { return false; }
  },

  async recover(words) {
    try {
      const seed = this.w2s(words);
      if (!seed) return null;
      return { seed, key: await this._dataKey(seed) };
    } catch { return null; }
  },

  async resetPin(pin, seed) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pk = await this._pinKey(pin, salt);
    const enc = await this._encRaw(seed, pk);
    localStorage.setItem('ml_crypto', JSON.stringify({
      salt: this.hex(salt), enc, v: '4'
    }));
  },

  async enc(obj) {
    if (!this.key) throw new Error('locked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, this.key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return { _ml: true, iv: this.hex(iv), d: this.hex(new Uint8Array(ct)) };
  },

  async dec(blob) {
    if (!blob || !blob._ml) return blob;
    if (!this.key) throw new Error('locked');
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.unhex(blob.iv) }, this.key, this.unhex(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  },

  lock() { this.key = null; },

  // ── 1000 iterazioni: istantaneo su qualsiasi mobile ──
  async _pinKey(pin, salt) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },

  async _dataKey(seed) {
    const base = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife_v4'),
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

  s2w(seed) { return Array.from(seed).slice(0,12).map(b => WL[b % WL.length]); },
  w2s(words) {
    if (words.length !== 12) return null;
    const ix = words.map(w => WL.indexOf(w.toLowerCase().trim()));
    if (ix.some(i => i < 0)) return null;
    return new Uint8Array(ix);
  },
  hex(b) { return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join(''); },
  unhex(h) { return new Uint8Array(h.match(/.{2}/g).map(b => parseInt(b,16))); }
};

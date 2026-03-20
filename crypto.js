// ═══════════════════════════════════════════════
// My Life — crypto.js  v3.0 DEFINITIVO
// Algoritmi puri: AES-256-GCM + SHA-256
// Nessun PBKDF2 — istantaneo su mobile
// Espone: window.CR
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// WORDLIST
// ══════════════════════════════════════════════════════
const WL = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];

// ══════════════════════════════════════════════════════
// CRYPTO — AES-256-GCM + SHA-256 per PIN check
// NIENTE PBKDF2 — risolto il problema delle attese
// La chiave è derivata con SHA-256 (istantaneo)
// La sicurezza offline è garantita dalle 12 parole
// (seed casuale a 32 byte = impossibile da bruteforce)
// ══════════════════════════════════════════════════════
const CR = {
  _key: null, // chiave dati attiva

  // Derive key from PIN + deviceId using SHA-256 (instant)
  async pinToKey(pin, deviceId) {
    const raw = new TextEncoder().encode('mylife:v3:' + pin + ':' + deviceId);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    return crypto.subtle.importKey('raw', hash, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
  },

  // Derive data key from seed using HKDF
  async seedToDataKey(seed) {
    const base = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'HKDF', hash:'SHA-256',
        salt: new TextEncoder().encode('mylife:data:v3'),
        info: new TextEncoder().encode('data_key') },
      base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
    );
  },

  // Encrypt any data
  async enc(data, key) {
    const k = key || this._key;
    if (!k) throw new Error('no key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data));
    const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, k, raw);
    return { iv: h(iv), d: h(new Uint8Array(ct)) };
  },

  // Decrypt blob
  async dec(blob, key) {
    if (!blob || !blob.iv) return blob;
    const k = key || this._key;
    if (!k) throw new Error('no key');
    const raw = await crypto.subtle.decrypt(
      {name:'AES-GCM', iv: uh(blob.iv)}, k, uh(blob.d)
    );
    return raw;
  },

  // Encrypt app object
  async encObj(obj) {
    if (!this._key) throw new Error('locked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      {name:'AES-GCM', iv}, this._key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return {_ml:true, iv:h(iv), d:h(new Uint8Array(ct))};
  },

  // Decrypt app object
  async decObj(blob) {
    if (!blob || !blob._ml) return blob;
    if (!this._key) throw new Error('locked');
    const raw = await crypto.subtle.decrypt(
      {name:'AES-GCM', iv:uh(blob.iv)}, this._key, uh(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  },

  // 12 words from seed
  seedToWords(seed) {
    return Array.from(seed).slice(0,12).map(b => WL[b % WL.length]);
  },

  // Seed from 12 words
  wordsToSeed(words) {
    if (!words || words.length !== 12) return null;
    const clean = words.map(w => (w||'').toLowerCase().trim());
    const idxs = clean.map(w => WL.indexOf(w));
    if (idxs.some(i => i < 0)) return null;
    const seed = new Uint8Array(32);
    idxs.forEach((v,i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) seed[i] = (seed[i-12] ^ seed[i-6] ^ 0x5A) % 256;
    return seed;
  },

  lock() { this._key = null; }
};

function h(b) { return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(''); }
function uh(s) { return new Uint8Array((s.match(/.{2}/g)||[]).map(b=>parseInt(b,16))); }


// Crypto Engine
const CR = {
  _key: null,

  async pinToKey(pin, deviceId) {
    const raw = new TextEncoder().encode('mylife:v3:' + pin + ':' + deviceId);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    return crypto.subtle.importKey('raw', hash, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
  },

  async seedToDataKey(seed) {
    const base = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'HKDF', hash:'SHA-256',
        salt: new TextEncoder().encode('mylife:data:v3'),
        info: new TextEncoder().encode('data_key') },
      base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
    );
  },

  async enc(data, key) {
    const k = key || this._key;
    if (!k) throw new Error('no key');
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const raw = data instanceof Uint8Array ? data : new TextEncoder().encode(JSON.stringify(data));
    const ct  = await crypto.subtle.encrypt({name:'AES-GCM', iv}, k, raw);
    return { iv: h(iv), d: h(new Uint8Array(ct)) };
  },

  async dec(blob, key) {
    if (!blob || !blob.iv) return blob;
    const k = key || this._key;
    if (!k) throw new Error('no key');
    return new Uint8Array(await crypto.subtle.decrypt(
      {name:'AES-GCM', iv: uh(blob.iv)}, k, uh(blob.d)
    ));
  },

  async encObj(obj) {
    if (!this._key) throw new Error('locked');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      {name:'AES-GCM', iv}, this._key,
      new TextEncoder().encode(JSON.stringify(obj))
    );
    return {_ml:true, iv:h(iv), d:h(new Uint8Array(ct))};
  },

  async decObj(blob) {
    if (!blob || !blob._ml) return blob;
    if (!this._key) throw new Error('locked');
    const raw = await crypto.subtle.decrypt(
      {name:'AES-GCM', iv:uh(blob.iv)}, this._key, uh(blob.d)
    );
    return JSON.parse(new TextDecoder().decode(raw));
  },

  seedToWords(seed) {
    return Array.from(seed).slice(0,12).map(b => WL[b % WL.length]);
  },

  wordsToSeed(words) {
    if (!words || words.length !== 12) return null;
    const clean = words.map(w => (w||'').toLowerCase().trim());
    const idxs  = clean.map(w => WL.indexOf(w));
    if (idxs.some(i => i < 0)) return null;
    const seed = new Uint8Array(32);
    idxs.forEach((v,i) => { seed[i] = v % 256; });
    for (let i = 12; i < 32; i++) seed[i] = (seed[i-12] ^ seed[i-6] ^ 0x5A) % 256;
    return seed;
  },

  lock() { this._key = null; }
};

function h(b)  { return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(''); }
function uh(s) { return new Uint8Array((s.match(/.{2}/g)||[]).map(b=>parseInt(b,16))); }

window.CR = CR;
window.h  = h;
window.uh = uh;

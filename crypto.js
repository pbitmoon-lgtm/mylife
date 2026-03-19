// ═══════════════════════════════════════════════
// My Life — crypto.js
// M2.0 · Cifratura AES-256-GCM + PIN + Recovery
// Dipendenze: nessuna
// Esporta: window.CE (Crypto Engine)
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// WORDLIST
// ═══════════════════════════════════════════════
const WL=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','afford','afraid','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis','baby','balance','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brave','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer'];



// ═══════════════════════════════════════════════
// CRYPTO ENGINE
// ═══════════════════════════════════════════════
const CE={
  key:null,
  ok(){return!!localStorage.getItem('ml_crypto')},
  async setup(pin){
    const seed=crypto.getRandomValues(new Uint8Array(16));
    const words=this.s2w(seed);
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const pk=await this.pinKey(pin,salt);
    const enc=await this.encRaw(seed,pk);
    this.key=await this.dataKey(seed);
    localStorage.setItem('ml_crypto',JSON.stringify({salt:this.hex(salt),enc,v:'2'}));
    return words;
  },
  async unlock(pin){
    const c=JSON.parse(localStorage.getItem('ml_crypto'));
    if(!c)return false;
    try{
      const pk=await this.pinKey(pin,this.unhex(c.salt));
      const seed=await this.decRaw(c.enc,pk);
      this.key=await this.dataKey(seed);
      return true;
    }catch{return false;}
  },
  async recover(words){
    try{
      const seed=this.w2s(words);if(!seed)return null;
      return{seed,key:await this.dataKey(seed)};
    }catch{return null;}
  },
  async resetPin(pin,seed){
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const pk=await this.pinKey(pin,salt);
    const enc=await this.encRaw(seed,pk);
    const c=JSON.parse(localStorage.getItem('ml_crypto')||'{}');
    c.salt=this.hex(salt);c.enc=enc;
    localStorage.setItem('ml_crypto',JSON.stringify(c));
  },
  async enc(obj){
    if(!this.key)throw new Error('locked');
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},this.key,new TextEncoder().encode(JSON.stringify(obj)));
    return{_ml:true,iv:this.hex(iv),d:this.hex(new Uint8Array(ct))};
  },
  async dec(b){
    if(!b||!b._ml)return b;
    if(!this.key)throw new Error('locked');
    const r=await crypto.subtle.decrypt({name:'AES-GCM',iv:this.unhex(b.iv)},this.key,this.unhex(b.d));
    return JSON.parse(new TextDecoder().decode(r));
  },
  async pinKey(pin,salt){
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  },
  async dataKey(seed){
    const base=await crypto.subtle.importKey('raw',seed,'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('MyLife_v2'),info:new TextEncoder().encode('data')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  },
  async encRaw(d,k){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,d);
    return{iv:this.hex(iv),d:this.hex(new Uint8Array(ct))};
  },
  async decRaw(b,k){
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:this.unhex(b.iv)},k,this.unhex(b.d)));
  },
  s2w(s){return Array.from(s).slice(0,12).map(b=>WL[b%WL.length])},
  w2s(ws){
    if(ws.length!==12)return null;
    const ix=ws.map(w=>WL.indexOf(w.toLowerCase().trim()));
    if(ix.some(i=>i<0))return null;
    return new Uint8Array(ix);
  },
  hex(b){return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('')},
  unhex(h){return new Uint8Array(h.match(/.{2}/g).map(x=>parseInt(x,16)))},
  lock(){this.key=null}
};


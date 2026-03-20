// ═══════════════════════════════════════════════
// My Life — app.js  v3.0 DEFINITIVO
// Core: stato, navigazione, boot, lock, setup, recovery
// Dipende da: crypto.js, auth.js, db.js
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// ERROR HANDLER
// ══════════════════════════════════════════════════════
function showErr(msg) {
  const b = document.getElementById('err');
  b.style.display = 'block';
  b.textContent = '⚠️ ' + msg;
  console.error('[ERR]', msg);
}
window.addEventListener('error', e => showErr(e.message + ' (' + (e.filename||'').split('/').pop() + ':' + e.lineno + ')'));
window.addEventListener('unhandledrejection', e => showErr(String(e.reason?.message || e.reason)));

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
const S = {
  lockPin:'', setupPin:'', confirmPin:'',
  recovWords:[], verifyIdx:[],
  recovMode:false, recovSeed:null,
  tracking:false, trip:null, lastPos:null, pendPos:null,
  watchId:null, timerInt:null, startTime:null, totalDist:0,
  map:null, poly:null, markers:[], curMk:null, userMk:null,
  favMode:false, pendFav:null, selIcon:'📍',
  pendPhoto:null,
};

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'map-screen' && !S.map) initMap();
}

function showStep(id) {
  ['step-welcome','step-pin','step-confirm','step-phrase','step-verify']
    .forEach(s => document.getElementById(s).style.display = 'none');
  document.getElementById(id).style.display = 'flex';
  // Costruisce la UI di verifica quando si arriva allo step
  if (id === 'step-verify') buildVerifyUI();
}

// ══════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════
window.addEventListener('load', async () => {
  try {
    await initDB();

    if (!UF.exists()) {
      console.log('[boot] primo avvio');
      showScreen('setup-screen');
      showStep('step-welcome');
      return;
    }

    const same = await UF.sameDevice();
    if (!same) {
      console.log('[boot] device diverso');
      showScreen('recovery-screen');
      buildRecovery('new-device');
      return;
    }

    console.log('[boot] lock screen');
    showScreen('lock-screen');

  } catch(e) {
    showErr('Boot error: ' + e.message);
  }
});

// ══════════════════════════════════════════════════════
// LOCK — PIN istantaneo (SHA-256, no PBKDF2)
// ══════════════════════════════════════════════════════
let _locking = false;

async function lockKey(d) {
  if (_locking || S.lockPin.length >= 6) return;
  S.lockPin += d;
  updDots('lock-dots', 'lock-dots', S.lockPin.length, false);

  if (S.lockPin.length === 6) {
    _locking = true;
    document.getElementById('lock-sub').textContent = '🔓 Verifica...';
    await tick();

    try {
      const u = UF.read();
      if (!u) { showErr('Nessun utente'); _locking=false; return; }

      const deviceId = await getDeviceId();
      const pinKey   = await CR.pinToKey(S.lockPin, deviceId);

      // Decifra il seed con la chiave PIN
      const seedRaw = await CR.dec(u.encSeed, pinKey);
      const seed    = new Uint8Array(seedRaw);

      // Attiva chiave dati
      CR._key = await CR.seedToDataKey(seed);

      // Successo
      setDots('lock-dots', 'ok');
      await sleep(150);
      _locking = false;
      enterApp();

    } catch(e) {
      console.log('[lock] PIN errato:', e.message);
      setDots('lock-dots', 'err');
      document.getElementById('lock-sub').textContent = 'PIN errato. Riprova.';
      if (navigator.vibrate) navigator.vibrate([80,40,80]);
      await sleep(900);
      S.lockPin = '';
      _locking  = false;
      updDots('lock-dots', 'lock-dots', 0, false);
      document.getElementById('lock-sub').textContent = 'La tua privacy, sulla chain, per sempre';
    }
  }
}

function lockDel() {
  if (_locking) return;
  if (S.lockPin.length > 0) {
    S.lockPin = S.lockPin.slice(0,-1);
    updDots('lock-dots', 'lock-dots', S.lockPin.length, false);
  }
}

// ══════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════
function setupKey(d) {
  if (S.setupPin.length >= 6) return;
  S.setupPin += d;
  updDots('setup-dots', 'setup', S.setupPin.length, false);
  if (S.setupPin.length === 6) setTimeout(() => showStep('step-confirm'), 200);
}
function setupDel() {
  S.setupPin = S.setupPin.slice(0,-1);
  updDots('setup-dots', 'setup', S.setupPin.length, false);
}

let _confirming = false;
async function confirmKey(d) {
  if (_confirming || S.confirmPin.length >= 6) return;
  S.confirmPin += d;
  updDots('confirm-dots', 'confirm', S.confirmPin.length, false);

  if (S.confirmPin.length === 6) {
    if (S.confirmPin !== S.setupPin) {
      setDots('confirm-dots', 'err');
      await sleep(800);
      S.confirmPin = '';
      updDots('confirm-dots', 'confirm', 0, false);
      return;
    }

    _confirming = true;
    const sub = document.getElementById('confirm-sub');
    if (sub) sub.textContent = '⚙️ Configurazione...';
    await tick();

    try {
      if (S.recovMode) {
        // Migrazione: riconfigura utente su questo device
        const deviceId = await getDeviceId();
        const pinKey   = await CR.pinToKey(S.setupPin, deviceId);
        const encSeed  = await CR.enc(S.recovSeed, pinKey);
        const existing = UF.read();

        UF.write({
          v: '3',
          userId:    existing?.userId || CR.h(crypto.getRandomValues(new Uint8Array(16))),
          deviceId,
          created:   existing?.created || today(),
          migratedAt: today(),
          encSeed,
          backupVerified: true,
        });

        CR._key     = await CR.seedToDataKey(S.recovSeed);
        S.recovMode = false;
        S.recovSeed = null;
        _confirming = false;
        enterApp();

      } else {
        // Primo avvio: crea utente
        const seed     = crypto.getRandomValues(new Uint8Array(32));
        const words    = CR.seedToWords(seed);
        const deviceId = await getDeviceId();
        const pinKey   = await CR.pinToKey(S.setupPin, deviceId);
        const encSeed  = await CR.enc(seed, pinKey);

        UF.write({
          v: '3',
          userId:   CR.h(crypto.getRandomValues(new Uint8Array(16))),
          deviceId,
          created:  today(),
          encSeed,
          backupVerified: false,
        });

        CR._key      = await CR.seedToDataKey(seed);
        S.recovWords = words;
        _confirming  = false;

        // Mostra 12 parole
        document.getElementById('phrase-grid').innerHTML =
          words.map((w,i) =>
            `<div class="phrase-word">
              <span class="pnum">${String(i+1).padStart(2,'0')}</span>
              <span class="pword">${w}</span>
            </div>`
          ).join('');
        showStep('step-phrase');
      }

    } catch(e) {
      _confirming = false;
      showErr('Setup error: ' + e.message);
    }
  }
}
function confirmDel() {
  if (_confirming) return;
  S.confirmPin = S.confirmPin.slice(0,-1);
  updDots('confirm-dots', 'confirm', S.confirmPin.length, false);
}

function buildVerifyUI() {
  S.verifyIdx = [];
  while (S.verifyIdx.length < 4) {
    const n = Math.floor(Math.random()*12);
    if (!S.verifyIdx.includes(n)) S.verifyIdx.push(n);
  }
  S.verifyIdx.sort((a,b)=>a-b);
  document.getElementById('verify-grid').innerHTML = S.verifyIdx.map(i =>
    `<div class="rrow">
      <span class="rnum">#${i+1}</span>
      <input class="rinput" data-i="${i}" placeholder="parola ${i+1}..."
        autocomplete="off" autocorrect="off" spellcheck="false" oninput="chkVerify()">
    </div>`
  ).join('');
}

function chkVerify() {
  let ok = true;
  document.querySelectorAll('#verify-grid .rinput').forEach(inp => {
    const v = inp.value.trim().toLowerCase();
    if (!v) { inp.className='rinput'; ok=false; }
    else if (v === S.recovWords[+inp.dataset.i]) inp.className='rinput ok';
    else { inp.className='rinput err'; ok=false; }
  });
  document.getElementById('verify-btn').disabled = !ok;
}

async function finishSetup() {
  try {
    const u = UF.read();
    if (u) { u.backupVerified = true; UF.write(u); }
    await enterApp();
  } catch(e) {
    showErr('finishSetup error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════
// RECOVERY
// ══════════════════════════════════════════════════════
function buildRecovery(mode) {
  const t = document.getElementById('rec-title');
  const s = document.getElementById('rec-sub');
  if (mode === 'new-device') {
    if (t) t.textContent = '📱 Nuovo dispositivo';
    if (s) s.textContent = 'Inserisci le 12 parole per trasferire il tuo account su questo telefono.';
  } else {
    if (t) t.textContent = '🔑 Recupero accesso';
    if (s) s.textContent = 'Inserisci le 12 parole di backup.';
  }
  document.getElementById('rec-err').textContent = '';
  document.getElementById('rec-grid').innerHTML =
    Array.from({length:12},(_,i) =>
      `<div class="rrow">
        <span class="rnum">#${i+1}</span>
        <input class="rinput" id="rw${i}" placeholder="parola ${i+1}..."
          autocomplete="off" autocorrect="off" spellcheck="false"
          style="text-transform:lowercase">
      </div>`
    ).join('');
}

async function doRecovery() {
  const words = Array.from({length:12},(_,i)=>{
    const el = document.getElementById('rw'+i);
    return el ? el.value.trim().toLowerCase() : '';
  });

  const e = document.getElementById('rec-err');
  e.style.color = 'var(--text2)';
  e.textContent = '🔍 Verifica parole...';

  const seed = CR.wordsToSeed(words);
  if (!seed) {
    e.style.color = 'var(--red)';
    e.textContent = '❌ Parole non corrette. Controlla e riprova.';
    return;
  }

  // Parole corrette — vai a impostare nuovo PIN
  S.recovSeed = seed;
  S.recovMode = true;
  S.setupPin  = '';
  S.confirmPin = '';
  showScreen('setup-screen');
  showStep('step-pin');
  document.getElementById('pin-sub').textContent = 'Scegli un nuovo PIN per questo dispositivo.';
}

// ══════════════════════════════════════════════════════
// APP
// ══════════════════════════════════════════════════════
async function enterApp() {
  updateHomeTime();
  setInterval(updateHomeTime, 30000);
  try {
    const notes = await dbAll('notes');
    document.getElementById('w-notes-badge').textContent = notes.length + ' note';
  } catch {}
  showScreen('home-screen');
}

function updateHomeTime() {
  const el = document.getElementById('home-time');
  if (!el) return;
  const now = new Date();
  el.textContent =
    now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) + ' · ' +
    now.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'});
}

function lockApp() {
  CR.lock();
  if (S.tracking) stopTrip();
  S.lockPin = '';
  showScreen('lock-screen');
  updDots('lock-dots','lock-dots',0,false);
  document.getElementById('lock-sub').textContent = 'La tua privacy, sulla chain, per sempre';
}

function confirmReset() {
  if (!confirm(
    'ATTENZIONE\n\n' +
    'Questa operazione cancella TUTTI i dati:\n' +
    '- Viaggi, note, preferiti\n' +
    '- Account e PIN\n\n' +
    'Usare SOLO se hai perso le 12 parole.\n\n' +
    'Sei sicuro?'
  )) return;
  localStorage.clear();
  indexedDB.deleteDatabase('MyLife');
  location.reload();
}

// ══════════════════════════════════════════════════════
// PIN PAD TOUCH HANDLER
// ══════════════════════════════════════════════════════
const KEY_FNS = {
  lockKey, lockDel,
  setupKey, setupDel,
  confirmKey, confirmDel
};

// Mappa dots prefix
function dotPfx(id) {
  if (id === 'lock-dots') return 'd';
  if (id === 'setup-dots') return 's';
  if (id === 'confirm-dots') return 'c';
  return 'd';
}

function updDots(dotId, _, n, err) {
  const pfx = dotPfx(dotId);
  for (let i=0; i<6; i++) {
    const el = document.getElementById(pfx+i);
    if (!el) continue;
    el.className = 'dot' + (err?' err': i<n?' on':'');
  }
}

function setDots(dotId, state) {
  const pfx = dotPfx(dotId);
  for (let i=0; i<6; i++) {
    const el = document.getElementById(pfx+i);
    if (el) el.className = 'dot ' + state;
  }
}

let _lastTouch = 0;
document.addEventListener('touchstart', e => {
  const key = e.target.closest('.key');
  if (!key || key.classList.contains('empty')) return;
  e.preventDefault();
  _lastTouch = Date.now();
  key.classList.add('pressed');
  setTimeout(()=>key.classList.remove('pressed'), 150);
  if (navigator.vibrate) navigator.vibrate(8);
  const fn = key.dataset.fn;
  const v  = key.dataset.v;
  if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
}, {passive:false});

document.addEventListener('click', e => {
  if (Date.now() - _lastTouch < 500) return; // evita doppio su mobile
  const key = e.target.closest('.key');
  if (!key || key.classList.contains('empty')) return;
  const fn = key.dataset.fn;
  const v  = key.dataset.v;
  if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
});

// Intercept back gesture
window.addEventListener('popstate', () => {
  const active = document.querySelector('.screen.active');
  if (active && active.id !== 'home-screen' && active.id !== 'lock-screen') {
    history.pushState({}, '');
    if (active.id === 'map-screen') showScreen('home-screen');
  }
});
window.history.pushState({}, '');

// ══════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════
function hav(a,b,c,d) {
  const R=6371000,da=(c-a)*Math.PI/180,db=(d-b)*Math.PI/180;
  const x=Math.sin(da/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(db/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function today() { return new Date().toISOString().split('T')[0]; }
function tick() { return new Promise(r => setTimeout(r, 30)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


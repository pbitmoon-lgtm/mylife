// ═══════════════════════════════════════════════
// My Life — app.js
// Core: stato globale, navigazione, boot, lock,
//       setup wizard, recovery, home widgets
// Dipendenze: tutti gli altri moduli
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
function hav(a,b,c,d){const R=6371000,dA=(c-a)*Math.PI/180,dB=(d-b)*Math.PI/180;const x=Math.sin(dA/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dB/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
function resize(file,maxW,cb){const img=new Image();img.onload=()=>{const r=Math.min(maxW/img.width,1);const c=document.createElement('canvas');c.width=img.width*r;c.height=img.height*r;c.getContext('2d').drawImage(img,0,0,c.width,c.height);cb(c.toDataURL('image/jpeg',.8));};img.src=URL.createObjectURL(file);}
function fmtDate(ts){const d=new Date(ts);return d.toLocaleDateString('it-IT',{day:'numeric',month:'short'});}
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const S={
  lang:'it',autoMode:false,sensitivity:'medium',
  tracking:false,trip:null,lastPos:null,pendPos:null,
  watchId:null,timerInt:null,startTime:null,totalDist:0,
  map:null,poly:null,markers:[],curMarker:null,userMarker:null,
  favMode:false,pendFav:null,selIcon:'📍',pendPhoto:null,
  ptab:'trips',
  setupPin:'',confirmPin:'',recovWords:[],verifyIdx:[],
  lockPin:'',recovSeed:null,recovMode:false,
  notes:[],curNote:null,noteBlocks:[],notePin:false,noteColor:'default',noteTags:[],
  activeTag:null,
  pendImport:null,
};
const SENS={low:{d:200},medium:{d:80},high:{d:25}};



// ═══════════════════════════════════════════════
// NAV — History API per gesto indietro del telefono
// ═══════════════════════════════════════════════
let currentScreen = 'lock-screen';
const LOCKED_SCREENS = new Set(['lock-screen','setup-screen','recovery-screen']);

function navTo(id) {
  document.querySelector('.screen.active')?.classList.remove('active');
  document.getElementById(id).classList.add('active');
  currentScreen = id;
}

function openSection(id) {
  history.pushState({ screen: id }, '');
  navTo(id);
  if (id === 'map-screen' && !S.map) initMap();
  if (id === 'notes-screen') {
    document.getElementById('notes-fab').classList.add('visible');
    renderNotes();
  } else {
    document.getElementById('notes-fab').classList.remove('visible');
  }
  updateHomeWidgets();
}

function closeSection() {
  if (history.state?.screen) history.back();
  else _goHome();
}

function _goHome() {
  navTo('home-screen');
  document.getElementById('notes-fab').classList.remove('visible');
  document.querySelectorAll('.sub-panel.open').forEach(p => p.classList.remove('open'));
  document.getElementById('note-editor').classList.remove('open');
  updateHomeWidgets();
}

// Intercetta il gesto indietro del telefono
window.addEventListener('popstate', e => {
  if (LOCKED_SCREENS.has(currentScreen)) return;

  // Note editor aperto → chiudi editor prima
  if (document.getElementById('note-editor').classList.contains('open')) {
    document.getElementById('note-editor').classList.remove('open');
    document.getElementById('notes-fab').classList.add('visible');
    loadNotes().then(renderNotes);
    history.pushState({ screen: 'notes-screen' }, '');
    return;
  }

  // Sub-panel aperto → chiudi sub-panel prima
  const openPanel = document.querySelector('.sub-panel.open');
  if (openPanel) {
    openPanel.classList.remove('open');
    history.pushState({ screen: currentScreen }, '');
    return;
  }

  // Altrimenti torna alla home
  _goHome();
});

function openSubPanel(id) {
  history.pushState({ screen: currentScreen, panel: id }, '');
  document.getElementById(id).classList.add('open');
}
function closeSubPanel(id) {
  document.getElementById(id).classList.remove('open');
  if (history.state?.panel) history.back();
}



// ═══════════════════════════════════════════════
// HOME WIDGETS UPDATE
// ═══════════════════════════════════════════════
async function updateHomeWidgets(){
  // Time
  const now=new Date();
  document.getElementById('home-time').textContent=
    now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+' · '+
    now.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'});

  // Notes badge
  try{
    const notes=await dbAll('notes');
    S.notes=notes;
    document.getElementById('w-notes-badge').textContent=`${notes.length} note`;
    const last=notes.sort((a,b)=>(b.updatedAt||b.id)-(a.updatedAt||a.id))[0];
    if(last)document.getElementById('w-notes-preview').textContent=last.title||last.text||'Nota senza titolo';
  }catch{}

  // Map status
  if(S.tracking){
    document.getElementById('w-map-badge').textContent='● REC';
    document.getElementById('w-map-badge').className='widget-badge live';
  }
}

setInterval(()=>{
  const el=document.getElementById('home-time');
  if(el&&currentScreen==='home-screen'){
    const now=new Date();
    el.textContent=now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+' · '+
      now.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'});
  }
},30000);



// ═══════════════════════════════════════════════
// BOOT — flusso definitivo con device fingerprint
// ═══════════════════════════════════════════════
window.addEventListener('load', async () => {
  history.replaceState({ screen: 'base' }, '');
  await initDB();
  loadSettings();

  if (!CE.ok()) {
    // Nessun utente configurato su questo device → wizard
    console.log('[boot] nessun utente → setup wizard');
    localStorage.removeItem('ml_iter'); // reset calibrazione
    navTo('setup-screen');
    goStep('step-welcome');
    return;
  }

  // Controlla se è lo stesso device
  const sameDevice = await CE.sameDevice();
  if (!sameDevice) {
    // Utente esiste ma su device diverso → recovery con 12 parole
    console.log('[boot] device diverso → recovery');
    navTo('recovery-screen');
    buildRecoveryForm('new-device'); // mostra messaggio specifico
    return;
  }

  // Stesso device → lock screen normale
  console.log('[boot] device riconosciuto → lock screen');
  navTo('lock-screen');
});



// ═══════════════════════════════════════════════
// LOCK — sblocco con PIN
// ═══════════════════════════════════════════════
let _pinLocked = false;

async function pinKey(d) {
  if (_pinLocked) return;
  if (S.lockPin.length >= 6) return;
  S.lockPin += d;
  dots('pin-dots', S.lockPin.length, false);

  if (S.lockPin.length === 6) {
    _pinLocked = true;
    document.getElementById('lock-sub').textContent = '🔓 Verifica...';
    await new Promise(r => setTimeout(r, 30));

    let result = false;
    try { result = await CE.unlock(S.lockPin); }
    catch(e) { console.error('[lock]', e); }

    if (result === true) {
      dotsSuccess('pin-dots');
      await new Promise(r => setTimeout(r, 150));
      _pinLocked = false;
      await unlockApp();

    } else if (result === 'wrong_device') {
      // Device cambiato → vai a recovery
      _pinLocked = false;
      S.lockPin = '';
      dots('pin-dots', 0, false);
      navTo('recovery-screen');
      buildRecoveryForm('new-device');

    } else {
      dots('pin-dots', 6, true);
      document.getElementById('lock-sub').textContent = 'PIN errato. Riprova.';
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      setTimeout(() => {
        S.lockPin = '';
        _pinLocked = false;
        dots('pin-dots', 0, false);
        document.getElementById('lock-sub').textContent = 'La tua privacy, sulla chain, per sempre';
      }, 900);
    }
  }
}

function pinDel() {
  if (_pinLocked) return;
  if (S.lockPin.length > 0) {
    S.lockPin = S.lockPin.slice(0, -1);
    dots('pin-dots', S.lockPin.length, false);
  }
}

function dotsSuccess(cid) {
  const pfx = cid==='pin-dots'?'d': cid==='setup-dots'?'sd':'cd';
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`${pfx}${i}`);
    if (el) el.className = 'pin-dot success';
  }
}

async function unlockApp() {
  navTo('home-screen');
  await updateHomeWidgets();
}

function lockApp() {
  CE.lock();
  if (S.tracking) stopTracking();
  document.getElementById('note-editor').classList.remove('open');
  S.lockPin = '';
  _pinLocked = false;
  navTo('lock-screen');
}

// Reset completo — ultima risorsa
function resetAppData() {
  if (!confirm('Cancellare TUTTI i dati e ricominciare da zero?\nQuesta operazione non è reversibile.\n\nUSA QUESTA OPZIONE SOLO SE HAI PERSO LE 12 PAROLE.')) return;
  localStorage.clear();
  indexedDB.deleteDatabase('MyLife');
  location.reload();
}

function dots(cid, n, err) {
  const pfx = cid==='pin-dots'?'d': cid==='setup-dots'?'sd':'cd';
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`${pfx}${i}`);
    if (!el) continue;
    el.className = 'pin-dot' + (err?' error': i<n?' filled':'');
  }
}



// ═══════════════════════════════════════════════
// SETUP — wizard primo avvio
// ═══════════════════════════════════════════════
function goStep(id) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'step-verify') buildVerify();
}

function setupKey(d) {
  if (S.setupPin.length >= 6) return;
  S.setupPin += d;
  dots('setup-dots', S.setupPin.length, false);
  if (S.setupPin.length === 6) setTimeout(() => goStep('step-confirm'), 200);
}
function setupDel() {
  S.setupPin = S.setupPin.slice(0, -1);
  dots('setup-dots', S.setupPin.length, false);
}

async function confirmKey(d) {
  if (S.confirmPin.length >= 6) return;
  S.confirmPin += d;
  dots('confirm-dots', S.confirmPin.length, false);

  if (S.confirmPin.length === 6) {
    if (S.confirmPin !== S.setupPin) {
      dots('confirm-dots', 6, true);
      const sub = document.querySelector('#step-confirm .wizard-sub');
      if (sub) sub.textContent = 'PIN diverso. Riprova.';
      setTimeout(() => {
        S.confirmPin = '';
        dots('confirm-dots', 0, false);
        if (sub) sub.textContent = 'Inseriscilo di nuovo per confermare.';
      }, 900);
      return;
    }

    // PIN confermato
    setTimeout(async () => {
      if (S.recovMode) {
        // Migrazione su nuovo device dopo recovery con 12 parole
        try {
          const sub = document.querySelector('#step-confirm .wizard-sub');
          if (sub) sub.textContent = '⚙️ Configurazione nuovo device...';
          await CE.migrate(S.setupPin, S.recovSeed);
          S.recovMode = false; S.recovSeed = null;
          document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
          await unlockApp();
        } catch(e) {
          console.error('[setup] migrate error:', e);
          alert('Errore nella configurazione. Riprova.');
        }
      } else {
        // Setup normale: primo avvio
        try {
          const sub = document.querySelector('#step-confirm .wizard-sub');
          if (sub) sub.textContent = '⚙️ Configurazione sicurezza...';
          S.recovWords = await CE.setup(S.setupPin);
          document.getElementById('phrase-grid').innerHTML =
            S.recovWords.map((w, i) =>
              `<div class="phrase-word">
                <span class="phrase-num">${String(i+1).padStart(2,'0')}</span>
                <span class="phrase-w">${w}</span>
              </div>`
            ).join('');
          goStep('step-phrase');
        } catch(e) {
          console.error('[setup] CE.setup error:', e);
          alert('Errore. Riprova.');
        }
      }
    }, 200);
  }
}
function confirmDel() {
  S.confirmPin = S.confirmPin.slice(0, -1);
  dots('confirm-dots', S.confirmPin.length, false);
}

function buildVerify() {
  S.verifyIdx = [];
  while (S.verifyIdx.length < 4) {
    const n = Math.floor(Math.random() * 12);
    if (!S.verifyIdx.includes(n)) S.verifyIdx.push(n);
  }
  S.verifyIdx.sort((a,b) => a-b);
  document.getElementById('verify-grid').innerHTML = S.verifyIdx.map(i =>
    `<div class="recovery-row">
      <span class="recovery-num">#${i+1}</span>
      <input class="recovery-input" data-i="${i}"
        placeholder="parola ${i+1}..." oninput="chkVerify()">
    </div>`
  ).join('');
}

function chkVerify() {
  let ok = true;
  document.querySelectorAll('#verify-grid .recovery-input').forEach(inp => {
    const v = inp.value.trim().toLowerCase();
    if (!v) { inp.className = 'recovery-input'; ok = false; }
    else if (v === S.recovWords[+inp.dataset.i]) inp.className = 'recovery-input ok';
    else { inp.className = 'recovery-input err'; ok = false; }
  });
  document.getElementById('verify-btn').disabled = !ok;
}

async function finishSetup() {
  CE.markBackupVerified();
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  await unlockApp();
}



// ═══════════════════════════════════════════════
// RECOVERY — accesso da nuovo device con 12 parole
// ═══════════════════════════════════════════════
function buildRecoveryForm(mode) {
  const titleEl = document.getElementById('rec-title');
  const subEl   = document.getElementById('rec-sub-text');

  if (mode === 'new-device') {
    if (titleEl) titleEl.textContent = '📱 Nuovo dispositivo rilevato';
    if (subEl)   subEl.textContent   = 'Inserisci le 12 parole di backup per trasferire il tuo account su questo telefono.';
  } else {
    if (titleEl) titleEl.textContent = '🔑 Recupero accesso';
    if (subEl)   subEl.textContent   = 'Inserisci le 12 parole di backup per accedere.';
  }

  document.getElementById('recovery-grid').innerHTML =
    Array.from({length: 12}, (_, i) =>
      `<div class="recovery-row">
        <span class="recovery-num">#${i+1}</span>
        <input class="recovery-input" id="rw${i}"
          placeholder="parola ${i+1}..."
          autocomplete="off" autocorrect="off" spellcheck="false"
          style="text-transform:lowercase">
      </div>`
    ).join('');
  document.getElementById('rec-err').textContent = '';
}

function showRecovery() {
  navTo('recovery-screen');
  buildRecoveryForm('forgot-pin');
}

async function doRecovery() {
  const words = Array.from({length: 12}, (_, i) => {
    const el = document.getElementById(`rw${i}`);
    return el ? el.value.trim().toLowerCase() : '';
  });

  const errEl = document.getElementById('rec-err');
  errEl.textContent = '🔍 Verifica parole...';
  errEl.style.color = 'var(--text2)';

  const result = await CE.recover(words);

  if (!result) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = '❌ Parole non corrette. Controlla e riprova.';
    return;
  }

  // Parole corrette → imposta nuovo PIN per questo device
  S.recovSeed  = result.seed;
  CE.key       = result.key;
  S.recovMode  = true;
  S.setupPin   = '';
  S.confirmPin = '';

  // Vai al wizard per scegliere il PIN su questo device
  navTo('setup-screen');
  goStep('step-pin');
}

// ═══════════════════════════════════════════════
// PIN KEY TOUCH HANDLER — risposta immediata su mobile
// ═══════════════════════════════════════════════
(function(){
  // Mappa funzioni per i tasti PIN
  const FN = {
    pinKey, pinDel, setupKey, setupDel, confirmKey, confirmDel
  };

  function handlePinKey(el, e) {
    if (el.classList.contains('empty')) return;
    e.preventDefault(); // blocca il click successivo su mobile

    // Feedback visivo immediato
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 150);

    // Vibrazione leggera se disponibile
    if (navigator.vibrate) navigator.vibrate(10);

    // Esegui la funzione
    const fn = el.dataset.fn;
    const val = el.dataset.val;
    if (fn && FN[fn]) {
      if (val !== undefined) FN[fn](val);
      else FN[fn]();
    }
  }

  // touchstart — risposta immediata, nessun delay
  document.addEventListener('touchstart', e => {
    const touch = e.changedTouches[0];
    // Cerca sia dal target diretto che dal punto di tocco (più affidabile)
    let key = e.target.closest('.pin-key');
    if (!key) {
      // Fallback: cerca l'elemento sotto il punto esatto di tocco
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) key = el.closest('.pin-key');
    }
    if (key) {
      key._touched = true;
      handlePinKey(key, e);
    }
  }, {passive: false});

  // touchend: rimuovi il flag
  document.addEventListener('touchend', e => {
    const key = e.target.closest('.pin-key');
    if (key) setTimeout(() => { key._touched = false; }, 300);
  }, {passive: true});

  // Fallback click per desktop (non su mobile — già gestito da touchstart)
  document.addEventListener('click', e => {
    const key = e.target.closest('.pin-key');
    if (!key || key._touched) return; // evita doppio fuoco su mobile
    handlePinKey(key, e);
  });
})();


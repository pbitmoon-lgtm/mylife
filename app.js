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
// BOOT
// ═══════════════════════════════════════════════
window.addEventListener('load', async () => {
  // Stato base nella cronologia: il primo gesto indietro non esce dall'app
  history.replaceState({ screen: 'base' }, '');

  await initDB();
  loadSettings();
  if (CE.ok()) navTo('lock-screen');
  else { navTo('setup-screen'); goStep('step-welcome'); }
});



// ═══════════════════════════════════════════════
// LOCK
// ═══════════════════════════════════════════════
let _pinLocked = false; // blocca il pad durante la verifica crypto

async function pinKey(d) {
  if (_pinLocked) return;
  if (S.lockPin.length >= 6) return;
  S.lockPin += d;
  dots('pin-dots', S.lockPin.length, false);

  if (S.lockPin.length === 6) {
    _pinLocked = true;
    document.getElementById('lock-sub').textContent = '🔓 Verifica in corso...';
    dotsSpinner('pin-dots');

    // Cede il controllo al browser per aggiornare l'UI prima della crypto
    await new Promise(r => setTimeout(r, 30));

    let ok = false;
    try {
      // Timeout di sicurezza: se impiega più di 5 secondi, mostra errore
      const result = await Promise.race([
        CE.unlock(S.lockPin),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      ok = result;
    } catch (err) {
      console.error('unlock error:', err);
      ok = false;
    }

    if (ok) {
      dotsSuccess('pin-dots');
      await new Promise(r => setTimeout(r, 200));
      await unlockApp();
    } else {
      dots('pin-dots', 6, true);
      const msg = S.lockPin === '------'
        ? 'Errore. Riprova.'
        : 'PIN errato. Riprova.';
      document.getElementById('lock-sub').textContent = msg;
      if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
      setTimeout(() => {
        S.lockPin = '';
        _pinLocked = false;
        dots('pin-dots', 0, false);
        document.getElementById('lock-sub').textContent = 'Inserisci il tuo PIN';
      }, 900);
      return;
    }
    _pinLocked = false;
  }
}

function pinDel() {
  if (_pinLocked) return;
  if (S.lockPin.length) {
    S.lockPin = S.lockPin.slice(0, -1);
    dots('pin-dots', S.lockPin.length, false);
  }
}

// Anima i pallini come spinner durante la verifica crypto
function dotsSpinner(cid) {
  const pfx = cid === 'pin-dots' ? 'd' : cid === 'setup-dots' ? 'sd' : 'cd';
  let i = 0;
  const interval = setInterval(() => {
    for (let j = 0; j < 6; j++) {
      const el = document.getElementById(`${pfx}${j}`);
      if (!el) continue;
      el.className = 'pin-dot' + (j === i % 6 ? ' filled' : '');
    }
    i++;
    if (!_pinLocked) clearInterval(interval);
  }, 120);
}

// Tutti i pallini verdi per un attimo prima di entrare
function dotsSuccess(cid) {
  const pfx = cid === 'pin-dots' ? 'd' : cid === 'setup-dots' ? 'sd' : 'cd';
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`${pfx}${i}`);
    if (el) el.className = 'pin-dot filled success';
  }
}
async function unlockApp(){
  navTo('home-screen');
  await updateHomeWidgets();
}
function lockApp(){
  CE.lock();S.tracking&&stopTracking();
  document.getElementById('note-editor').classList.remove('open');
  S.lockPin='';
  navTo('lock-screen');
}
function dots(cid,n,err){
  const pfx=cid==='pin-dots'?'d':cid==='setup-dots'?'sd':'cd';
  for(let i=0;i<6;i++){
    const el=document.getElementById(`${pfx}${i}`);if(!el)continue;
    el.className='pin-dot'+(err?' error':i<n?' filled':'');
  }
}



// ═══════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════
function goStep(id){
  document.querySelectorAll('.wizard-step').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(id==='step-verify')buildVerify();
}
function setupKey(d){
  if(S.setupPin.length>=6)return;
  S.setupPin+=d;dots('setup-dots',S.setupPin.length,false);
  if(S.setupPin.length===6)setTimeout(()=>goStep('step-confirm'),200);
}
function setupDel(){S.setupPin=S.setupPin.slice(0,-1);dots('setup-dots',S.setupPin.length,false);}
async function confirmKey(d){
  if(S.confirmPin.length>=6)return;
  S.confirmPin+=d;dots('confirm-dots',S.confirmPin.length,false);
  if(S.confirmPin.length===6){
    if(S.confirmPin===S.setupPin){
      setTimeout(async()=>{
        if(S.recovMode){
          await CE.resetPin(S.setupPin,S.recovSeed||new Uint8Array(16));
          S.recovMode=false;
          navTo('setup-screen');
          document.querySelectorAll('.wizard-step').forEach(s=>s.classList.remove('active'));
          await unlockApp();
        } else {
          S.recovWords=await CE.setup(S.setupPin);
          document.getElementById('phrase-grid').innerHTML=
            S.recovWords.map((w,i)=>`<div class="phrase-word"><span class="phrase-num">${String(i+1).padStart(2,'0')}</span><span class="phrase-w">${w}</span></div>`).join('');
          goStep('step-phrase');
        }
      },200);
    } else {
      dots('confirm-dots',6,true);
      setTimeout(()=>{S.confirmPin='';dots('confirm-dots',0,false);},800);
    }
  }
}
function confirmDel(){S.confirmPin=S.confirmPin.slice(0,-1);dots('confirm-dots',S.confirmPin.length,false);}
function buildVerify(){
  S.verifyIdx=[];
  while(S.verifyIdx.length<4){const n=Math.floor(Math.random()*12);if(!S.verifyIdx.includes(n))S.verifyIdx.push(n);}
  S.verifyIdx.sort((a,b)=>a-b);
  document.getElementById('verify-grid').innerHTML=S.verifyIdx.map(i=>
    `<div class="recovery-row"><span class="recovery-num">#${i+1}</span>
     <input class="recovery-input" data-i="${i}" placeholder="parola ${i+1}..." oninput="chkVerify()"></div>`
  ).join('');
}
function chkVerify(){
  let ok=true;
  document.querySelectorAll('#verify-grid .recovery-input').forEach(inp=>{
    const v=inp.value.trim().toLowerCase();
    if(!v){inp.className='recovery-input';ok=false;}
    else if(v===S.recovWords[+inp.dataset.i])inp.className='recovery-input ok';
    else{inp.className='recovery-input err';ok=false;}
  });
  document.getElementById('verify-btn').disabled=!ok;
}
async function finishSetup(){navTo('setup-screen');await unlockApp();}



// ═══════════════════════════════════════════════
// RECOVERY
// ═══════════════════════════════════════════════
function showRecovery(){
  navTo('recovery-screen');
  document.getElementById('recovery-grid').innerHTML=Array.from({length:12},(_,i)=>
    `<div class="recovery-row"><span class="recovery-num">#${i+1}</span>
     <input class="recovery-input" id="rw${i}" placeholder="parola ${i+1}..."></div>`
  ).join('');
}
async function doRecovery(){
  const words=Array.from({length:12},(_,i)=>document.getElementById(`rw${i}`).value.trim().toLowerCase());
  const r=await CE.recover(words);
  if(!r){document.getElementById('rec-err').textContent='Parole non corrette.';return;}
  S.recovSeed=r.seed;CE.key=r.key;S.recovMode=true;
  S.setupPin='';S.confirmPin='';
  navTo('setup-screen');goStep('step-pin');
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


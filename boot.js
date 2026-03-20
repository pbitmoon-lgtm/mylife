// ═══════════════════════════════════════════════════════
// My Life — boot.js
// Unico punto di ingresso dell'applicazione.
// Blocca il rendering finché l'ambiente è stabile.
// Gestisce la cascata di mount e la UI di autenticazione.
//
// Cascata:
//   boot → checkAndBoot
//     AUTH_NEED_SETUP    → mostra wizard setup
//     AUTH_NEED_PIN      → mostra lock screen
//     AUTH_NEED_RECOVERY → mostra recovery screen
//   utente autentica →
//     AUTH_SUCCESS_PRF → CRYPTO_KEY_DERIVED → STORAGE_MOUNTED → APP_READY
// ═══════════════════════════════════════════════════════

import State    from './state.js';
import Hardware from './hardware.js';
import './crypto.js';   // si auto-registra sugli eventi
import './db.js';       // si auto-registra sugli eventi
import UI       from './ui.js';

// ─── STATO UI LOCALE ──────────────────────────────────
let _setupPin   = '';
let _confirmPin = '';
let _recovMode  = false;
let _recovSeed  = null;
let _recovWords = [];
let _verifyIdx  = [];
let _pinLocked  = false;

// ─── BOOT SEQUENCE ────────────────────────────────────
async function boot() {
  console.log('[boot] avvio...');

  // Registra handler errori
  State.subscribe('SYSTEM_ERROR', ({ error }) => {
    UI.showError(error);
  });

  // Registra handler cascata di boot
  State.subscribe('AUTH_NEED_SETUP',    onNeedSetup);
  State.subscribe('AUTH_NEED_PIN',      onNeedPin);
  State.subscribe('AUTH_NEED_RECOVERY', onNeedRecovery);
  State.subscribe('CRYPTO_KEY_DERIVED', onKeyDerived);
  State.subscribe('CRYPTO_PERSIST_SEED', ({ encryptedSeed }) => {
    Hardware.persistSeed(encryptedSeed);
  });
  State.subscribe('STORAGE_MOUNTED',    onStorageMounted);
  State.subscribe('AUTH_RECOVERY_VERIFIED', onRecoveryVerified);
  State.subscribe('CRYPTO_LOCKED',      onLocked);

  // Avvia il controllo device
  await Hardware.checkAndBoot();
}

// ─── HANDLER STATI AUTH ───────────────────────────────

function onNeedSetup() {
  console.log('[boot] primo avvio → setup');
  UI.showScreen('setup-screen');
  UI.showStep('step-welcome');
}

function onNeedPin({ hasPRF }) {
  console.log('[boot] device riconosciuto → lock screen');
  UI.showScreen('lock-screen');
  UI.setText('lock-sub', 'La tua privacy, sulla chain, per sempre');
}

function onNeedRecovery({ reason }) {
  console.log('[boot] device non riconosciuto → recovery');
  UI.showScreen('recovery-screen');
  buildRecoveryUI(reason === 'new_device' ? 'new_device' : 'forgot_pin');
}

async function onKeyDerived({ isSetup, words }) {
  console.log('[boot] chiave derivata');
  if (isSetup && words) {
    _recovWords = words;
  }
  // db.js si monta automaticamente su questo evento
}

async function onStorageMounted() {
  console.log('[boot] storage montato → app pronta');
  State.dispatch('APP_READY');
  await enterApp();
}

function onRecoveryVerified({ seed }) {
  _recovSeed = seed;
  _recovMode = true;
  _setupPin  = '';
  _confirmPin = '';
  UI.showScreen('setup-screen');
  UI.showStep('step-pin');
  UI.setText('pin-sub', 'Scegli un nuovo PIN per questo dispositivo.');
}

function onLocked() {
  UI.showScreen('lock-screen');
  resetPinState();
}

// ─── LOCK SCREEN ──────────────────────────────────────
async function lockKey(d) {
  if (_pinLocked || _setupPin.length >= 6) return;
  // Nota: usiamo _setupPin come buffer temporaneo per il lock
  const buf = UI.getPinBuffer('lock');
  buf.push(d);
  UI.updateDots('lock-dots', buf.length, false);

  if (buf.length === 6) {
    _pinLocked = true;
    UI.setText('lock-sub', '🔓 Verifica...');
    const pin = buf.join('');
    buf.length = 0;
    await Hardware.unlockWithPin(pin);
  }
}

function lockDel() {
  if (_pinLocked) return;
  const buf = UI.getPinBuffer('lock');
  if (buf.length > 0) {
    buf.pop();
    UI.updateDots('lock-dots', buf.length, false);
  }
}

// Ascolta il risultato dell'unlock
State.subscribe('SYSTEM_ERROR', () => {
  UI.updateDotsState('lock-dots', 'err');
  UI.setText('lock-sub', 'PIN errato. Riprova.');
  if (navigator.vibrate) navigator.vibrate([80,40,80]);
  setTimeout(() => {
    _pinLocked = false;
    UI.updateDots('lock-dots', 0, false);
    UI.setText('lock-sub', 'La tua privacy, sulla chain, per sempre');
  }, 900);
});

// ─── SETUP WIZARD ─────────────────────────────────────
function setupKey(d) {
  if (_setupPin.length >= 6) return;
  _setupPin += d;
  UI.updateDots('setup-dots', _setupPin.length, false);
  if (_setupPin.length === 6) setTimeout(() => UI.showStep('step-confirm'), 200);
}

function setupDel() {
  _setupPin = _setupPin.slice(0,-1);
  UI.updateDots('setup-dots', _setupPin.length, false);
}

let _confirming = false;
async function confirmKey(d) {
  if (_confirming || _confirmPin.length >= 6) return;
  _confirmPin += d;
  UI.updateDots('confirm-dots', _confirmPin.length, false);

  if (_confirmPin.length === 6) {
    if (_confirmPin !== _setupPin) {
      UI.updateDotsState('confirm-dots', 'err');
      setTimeout(() => {
        _confirmPin = '';
        UI.updateDots('confirm-dots', 0, false);
      }, 800);
      return;
    }

    _confirming = true;
    UI.setText('confirm-sub', '⚙️ Configurazione sicurezza...');

    try {
      if (_recovMode && _recovSeed) {
        await Hardware.migrateWithPin(_setupPin, _recovSeed);
        _recovMode = false;
        _recovSeed = null;
      } else {
        await Hardware.setupWithPin(_setupPin);
      }
    } catch(e) {
      _confirming = false;
      UI.showError('Setup error: ' + e.message);
    }
    _confirming = false;
  }
}

function confirmDel() {
  if (_confirming) return;
  _confirmPin = _confirmPin.slice(0,-1);
  UI.updateDots('confirm-dots', _confirmPin.length, false);
}

// Mostra le 12 parole dopo setup
State.subscribe('CRYPTO_KEY_DERIVED', ({ isSetup, words }) => {
  if (!isSetup || !words) return;
  setTimeout(() => {
    const grid = document.getElementById('phrase-grid');
    if (!grid) return;
    grid.innerHTML = words.map((w,i) =>
      `<div class="phrase-word">
        <span class="pnum">${String(i+1).padStart(2,'0')}</span>
        <span class="pword">${w}</span>
      </div>`
    ).join('');
    UI.showStep('step-phrase');
  }, 100);
});

function buildVerifyUI() {
  _verifyIdx = [];
  while (_verifyIdx.length < 4) {
    const n = Math.floor(Math.random()*12);
    if (!_verifyIdx.includes(n)) _verifyIdx.push(n);
  }
  _verifyIdx.sort((a,b) => a-b);
  const grid = document.getElementById('verify-grid');
  if (!grid) return;
  grid.innerHTML = _verifyIdx.map(i =>
    `<div class="rrow">
      <span class="rnum">#${i+1}</span>
      <input class="rinput" data-i="${i}" placeholder="parola ${i+1}..."
        autocomplete="off" autocorrect="off" spellcheck="false">
    </div>`
  ).join('');
  // checkVerify è gestito dal listener delegato in boot.js
}

// checkVerify: listener delegato — nessuna funzione globale
function checkVerify() {
  let ok = true;
  document.querySelectorAll('#verify-grid .rinput').forEach(inp => {
    const v = inp.value.trim().toLowerCase();
    if (!v) { inp.className='rinput'; ok=false; }
    else if (v === _recovWords[+inp.dataset.i]) inp.className='rinput ok';
    else { inp.className='rinput err'; ok=false; }
  });
  const btn = document.getElementById('verify-btn');
  if (btn) btn.disabled = !ok;
}

// Listener delegato per gli input di verifica
document.addEventListener('input', e => {
  if (e.target.closest('#verify-grid')) checkVerify();
});

function finishSetup() {
  Hardware.markBackupVerified();
  // L'app è già pronta (STORAGE_MOUNTED è già stato emesso)
  enterApp();
}

// ─── RECOVERY ─────────────────────────────────────────
function buildRecoveryUI(mode) {
  const title = document.getElementById('rec-title');
  const sub   = document.getElementById('rec-sub');
  if (mode === 'new_device') {
    if (title) title.textContent = '📱 Nuovo dispositivo';
    if (sub)   sub.textContent   = 'Inserisci le 12 parole per trasferire il tuo account.';
  } else {
    if (title) title.textContent = '🔑 Recupero accesso';
    if (sub)   sub.textContent   = 'Inserisci le 12 parole di backup.';
  }
  const grid = document.getElementById('rec-grid');
  if (!grid) return;
  grid.innerHTML = Array.from({length:12},(_,i) =>
    `<div class="rrow">
      <span class="rnum">#${i+1}</span>
      <input class="rinput" id="rw${i}" placeholder="parola ${i+1}..."
        autocomplete="off" autocorrect="off" spellcheck="false"
        style="text-transform:lowercase">
    </div>`
  ).join('');
  const err = document.getElementById('rec-err');
  if (err) err.textContent = '';
}

async function doRecovery() {
  const words = Array.from({length:12},(_,i) => {
    const el = document.getElementById(`rw${i}`);
    return el ? el.value.trim().toLowerCase() : '';
  });
  const err = document.getElementById('rec-err');
  if (err) { err.style.color='var(--text2)'; err.textContent='🔍 Verifica...'; }
  await Hardware.recoverWithWords(words);
}

// Ascolto risultato recovery
State.subscribe('AUTH_FAILED', ({ reason }) => {
  const err = document.getElementById('rec-err');
  if (err) {
    err.style.color = 'var(--red)';
    err.textContent = reason === 'invalid_words'
      ? '❌ Parole non corrette. Controlla e riprova.'
      : '❌ Errore. Riprova.';
  }
  _pinLocked = false;
  UI.updateDots('lock-dots', 0, false);
  UI.setText('lock-sub', 'La tua privacy, sulla chain, per sempre');
});

// ─── APP ENTRY ────────────────────────────────────────
async function enterApp() {
  UI.showScreen('home-screen');
  updateHomeTime();
  setInterval(updateHomeTime, 30000);
  // Carica conteggio note per il widget
  State.dispatch('INTENT_LOAD_RECORDS', { type: 'note', requestId: 'home_widget' });
}

function updateHomeTime() {
  const el = document.getElementById('home-time');
  if (!el) return;
  const now = new Date();
  el.textContent =
    now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) + ' · ' +
    now.toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'});
}

// Aggiorna badge note nella home
State.subscribe('RECORDS_LOAD_STARTED', ({ type, count, requestId }) => {
  if (requestId === 'home_widget' && type === 'note') {
    const el = document.getElementById('w-notes-badge');
    if (el) el.textContent = count + ' note';
  }
});

function lockApp() {
  State.dispatch('CRYPTO_LOCK');
  resetPinState();
}

function resetPinState() {
  _setupPin   = '';
  _confirmPin = '';
  _pinLocked  = false;
  UI.updateDots('lock-dots', 0, false);
}

function confirmReset() {
  if (!confirm(
    'ATTENZIONE\n\nCancellare TUTTI i dati?\nUsare SOLO se hai perso le 12 parole.\n\nSei sicuro?'
  )) return;
  Hardware.fullReset();
  State.dispatch('INTENT_CLEAR_ALL');
  localStorage.clear();
  location.reload();
}

// ─── PIN PAD TOUCH HANDLER ────────────────────────────
const _pinBuffers = { lock:[], setup:[], confirm:[] };
// _getPinBuffer è interno — non esposto al window

const KEY_FNS = {
  lockKey, lockDel,
  setupKey, setupDel,
  confirmKey, confirmDel
};

let _lastTouch = 0;
document.addEventListener('touchstart', e => {
  const key = e.target.closest('.key');
  if (!key || key.classList.contains('empty')) return;
  e.preventDefault();
  _lastTouch = Date.now();
  key.classList.add('pressed');
  setTimeout(() => key.classList.remove('pressed'), 120);
  if (navigator.vibrate) navigator.vibrate(8);
  const fn = key.dataset.fn;
  const v  = key.dataset.v;
  if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
}, {passive:false});

document.addEventListener('click', e => {
  if (Date.now() - _lastTouch < 500) return;
  const key = e.target.closest('.key');
  if (!key || key.classList.contains('empty')) return;
  const fn = key.dataset.fn; const v = key.dataset.v;
  if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
});

// ─── BACK GESTURE ─────────────────────────────────────
window.addEventListener('popstate', () => {
  const screens = ['notes-screen','chat-screen','settings-screen'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
  document.getElementById('note-editor')?.classList.remove('open');
  document.getElementById('trips-panel')?.classList.remove('open');
  document.getElementById('fav-modal')?.classList.remove('open');
  document.getElementById('notes-fab')?.classList.remove('visible');
});
history.pushState({}, '');

// ─── INTENT DISPATCHER ───────────────────────────────
// Cattura i click sui bottoni con data-intent
// e li traduce in eventi puri per state.js.
// Zero funzioni globali — zero inquinamento del window.
// Event delegation per input nel verify grid
// Sostituisce oninput="checkVerify()" nell'HTML
document.addEventListener('input', e => {
  if (e.target.closest('#verify-grid')) {
    checkVerify();
  }
});

document.addEventListener('click', e => {
  const el     = e.target.closest('[data-intent]');
  const intent = el?.dataset.intent;
  if (!intent) return;

  const payload = el.dataset.payload
    ? JSON.parse(el.dataset.payload)
    : {};

  switch (intent) {
    case 'INTENT_LOCK_APP':
      State.dispatch('CRYPTO_LOCK');
      break;
    case 'INTENT_RESET_APP':
      if (confirm('ATTENZIONE\n\nCancellare TUTTI i dati?\nUsare SOLO se hai perso le 12 parole.\n\nSei sicuro?')) {
        Hardware.fullReset();
        State.dispatch('INTENT_CLEAR_ALL');
        localStorage.clear();
        location.reload();
      }
      break;
    case 'INTENT_RECOVERY':
      State.dispatch('AUTH_NEED_RECOVERY', { reason: 'forgot_pin' });
      break;
    case 'INTENT_SHOW_STEP':
      UI.showStep(payload.step);
      break;
    case 'INTENT_FINISH_SETUP':
      finishSetup();
      break;
    case 'INTENT_DO_RECOVERY':
      doRecovery();
      break;
    default:
      // Intent non gestito da boot — potrebbe essere gestito da altri moduli
      State.dispatch(intent, payload);
  }
});

// ─── ZK WORKER — SINGLETON ───────────────────────────
// Spawna il Web Worker ZK UNA SOLA VOLTA per sessione.
// APP_READY può essere emesso più volte (lock/unlock).
// Il Singleton Pattern garantisce un solo worker attivo.
let _zkWorker = null;

State.subscribe('APP_READY', () => {
  // Singleton: se il worker esiste già, non crearne un altro
  if (_zkWorker) {
    console.log('[boot] ZK worker già attivo — skip');
    return;
  }
  try {
    _zkWorker = new Worker('./zk-worker.js');
    _zkWorker.onmessage = e => {
      if (e.data.type === 'WORKER_READY') {
        console.log('[boot] ZK worker pronto (singleton)');
        State.dispatch('ZK_WORKER_READY');
      } else {
        State.dispatch('ZK_WORKER_MESSAGE', e.data);
      }
    };
    _zkWorker.onerror = err => {
      console.warn('[boot] ZK worker errore:', err.message);
      _zkWorker = null; // reset singleton se crash — permette retry
    };
  } catch (e) {
    console.warn('[boot] Web Worker non supportato:', e.message);
    _zkWorker = null;
  }
});

// Termina il worker quando la sessione viene bloccata
// Libera CPU e memoria immediatamente
State.subscribe('CRYPTO_LOCKED', () => {
  if (_zkWorker) {
    _zkWorker.terminate();
    _zkWorker = null;
    console.log('[boot] ZK worker terminato (sessione bloccata)');
  }
});

// ─── AVVIO ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);

export { lockKey, lockDel, setupKey, setupDel, confirmKey, confirmDel };

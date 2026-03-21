// ═══════════════════════════════════════════════════════
// My Life — boot.js (PRODUZIONE - CORRETTO E BLINDATO)
// Unico punto di ingresso dell'applicazione.
// Blocca il rendering finché l'ambiente è stabile.
// ═══════════════════════════════════════════════════════

import State    from './state.js';
import Hardware from './hardware.js';
import './crypto.js';   
import './db.js';       
import './backup.js';   
import './calendar.js'; 
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
  console.log('[boot] avvio in corso...');

  State.subscribe('SYSTEM_ERROR', ({ error }) => {
    UI.showError(error);
  });

  // Cascata di avvio
  State.subscribe('AUTH_NEED_SETUP', () => UI.showStep('step-setup'));
  State.subscribe('AUTH_NEED_PIN', () => UI.showStep('step-lock'));
  State.subscribe('AUTH_NEED_RECOVERY', () => UI.showStep('step-recovery'));

  State.subscribe('APP_READY', () => {
    UI.hideError();
    document.getElementById('boot-loader').style.display = 'none';
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('home-screen').classList.add('active');
    console.log('[boot] Sistema sbloccato e pronto.');
  });

  try {
    await Hardware.checkAndBoot();
  } catch (err) {
    State.dispatch('SYSTEM_ERROR', { error: 'Errore critico avvio: ' + err.message });
  }
}

// ─── EVENT DELEGATION (IL MURO DI GOMMA) ──────────────
// Intercetta tutti i click dell'HTML senza usare funzioni globali
document.addEventListener('click', e => {
  const intentElement = e.target.closest('[data-intent]');
  if (!intentElement) return;

  const intent = intentElement.dataset.intent;

  switch (intent) {
    case 'INTENT_LOCK_APP':
      State.dispatch('CRYPTO_LOCK');
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('auth-screen').classList.add('active');
      UI.showStep('step-lock');
      break;

    case 'INTENT_START_RECOVERY':
      State.dispatch('AUTH_NEED_RECOVERY');
      break;

    case 'INTENT_RESET_SYSTEM':
      if (confirm('ATTENZIONE: Distruggere irreversibilmente tutti i dati locali?')) {
        State.dispatch('INTENT_CLEAR_ALL');
        localStorage.clear();
        location.reload();
      }
      break;

    case 'INTENT_RESTORE_BACKUP':
      // Gestione sicura del ripristino Backup
      const pwd = document.getElementById('backup-pwd').value;
      const err = document.getElementById('restore-err');
      const prog = document.getElementById('restore-progress');
      const fileBuffer = window._restoreFileBuffer; // Letto dalla UI, sicuro.

      if (!fileBuffer) { err.textContent = 'Seleziona un file .enc'; return; }
      if (!pwd) { err.textContent = 'Inserisci la password di backup'; return; }
      if (!confirm('Ripristinare il backup? I dati correnti verranno sovrascritti irreversibilmente.')) return;

      err.textContent = '';
      prog.style.display = 'block';
      intentElement.disabled = true;

      const unsubOk = State.subscribe('BACKUP_RESTORED', ({ recordCount }) => {
        unsubOk(); unsubErr();
        prog.style.display = 'none';
        intentElement.disabled = false;
        document.getElementById('restore-panel').classList.remove('open');
        alert(`✅ Ripristino completato con successo: ${recordCount} record ripristinati.`);
        location.reload(); // Riavvia l'app per caricare i nuovi dati
      });

      const unsubErr = State.subscribe('RESTORE_ERROR', ({ error }) => {
        unsubOk(); unsubErr();
        prog.style.display = 'none';
        intentElement.disabled = false;
        err.textContent = '❌ ' + error;
      });

      State.dispatch('INTENT_RESTORE_VAULT', {
        fileBuffer: fileBuffer,
        password: pwd
      });
      break;
  }
});

// ─── ZK WORKER — SINGLETON E GRACEFUL SHUTDOWN ────────
let _zkWorker = null;
const _deadLetterQueue = [];

State.subscribe('APP_READY', () => {
  // Ripristina eventuali lavori interrotti
  if (_deadLetterQueue.length > 0) {
    console.log(`[boot] Ripristino ${_deadLetterQueue.length} job dalla coda di emergenza`);
    State.dispatch('ZK_RETRY_QUEUED_JOBS', { jobs: [..._deadLetterQueue] });
    _deadLetterQueue.length = 0;
  }

  // Crea il worker solo se non esiste (Singleton)
  if (_zkWorker) return;

  try {
    _zkWorker = new Worker('./zk-worker.js');
    _zkWorker.onmessage = e => {
      if (e.data.type === 'WORKER_READY') {
        State.dispatch('ZK_WORKER_READY');
      } else {
        State.dispatch('ZK_WORKER_MESSAGE', e.data);
      }
    };
    _zkWorker.onerror = err => {
      console.warn('[boot] ZK worker errore:', err.message);
      _zkWorker = null; 
    };
  } catch (e) {
    console.warn('[boot] Web Worker non supportato:', e.message);
  }
});

// Spegnimento sicuro (Graceful Shutdown)
State.subscribe('CRYPTO_LOCKED', () => {
  if (!_zkWorker) return;

  const SHUTDOWN_TIMEOUT_MS = 2000;
  const forceKill = setTimeout(() => {
    if (_zkWorker) { _zkWorker.terminate(); _zkWorker = null; }
  }, SHUTDOWN_TIMEOUT_MS);

  const onShutdownAck = e => {
    if (e.data?.type !== 'SHUTDOWN_ACK') return;
    clearTimeout(forceKill);
    _zkWorker.removeEventListener('message', onShutdownAck);

    // Salva i lavori interrotti nella coda
    const pendingJobs = e.data.pendingJobs || [];
    if (pendingJobs.length > 0) {
      _deadLetterQueue.push(...pendingJobs);
    }

    _zkWorker.terminate();
    _zkWorker = null;
  };

  _zkWorker.addEventListener('message', onShutdownAck);
  _zkWorker.postMessage({ type: 'INTENT_SHUTDOWN' });
});

// Innesco iniziale
boot();
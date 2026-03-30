// ═══════════════════════════════════════════════════════
// My Life — boot.js
// Unico punto di ingresso. Solo orchestrazione.
// Non contiene logica UI, PIN, o navigazione.
// ═══════════════════════════════════════════════════════

import State    from './state.js';
import Hardware from './hardware.js';
import UI       from './ui.js';
import './crypto.js';
import './db.js';
import './backup.js';
import './calendar.js';
import './sync.js';
import './wallet.js';
import './marketplace.js';

async function boot() {
  console.log('[boot] avvio in corso...');

  State.subscribe('SYSTEM_ERROR', ({ error }) => {
    _hideLoader();
    UI.showError(error);
  });

  State.subscribe('AUTH_NEED_SETUP', () => {
    _hideLoader(); _showAuth();
    UI.showStep('step-setup');
    setTimeout(() => window.Onboarding?.showWizStep('step-welcome'), 50);
  });

  State.subscribe('AUTH_NEED_PIN', () => {
    _hideLoader(); _showAuth();
    UI.showStep('step-lock');
  });

  State.subscribe('AUTH_NEED_RECOVERY', () => {
    _hideLoader(); _showAuth();
    window.Onboarding?.showRecovery();
  });

  State.subscribe('CRYPTO_PERSIST_SEED', ({ encryptedSeed }) => {
    Hardware.persistSeed(encryptedSeed);
  });

  State.subscribe('APP_READY', () => {
    UI.hideError();
    _hideLoader(); _hideAuth(); _showHome();
    console.log('[boot] ✅ Sistema sbloccato e pronto.');
    setTimeout(() => {
      State.dispatch('INTENT_LOAD_RECORDS', { type: 'note', requestId: 'home_badge' });
    }, 500);
  });

  State.subscribe('UPDATE_AVAILABLE', () => {
    const banner = document.getElementById('update-banner');
    if (banner) banner.style.display = 'flex';
  });

  _initGlobalIntents();
  _initZkWorker();

  try {
    await Hardware.checkAndBoot();
  } catch (err) {
    State.dispatch('SYSTEM_ERROR', { error: 'Errore critico avvio: ' + err.message });
  }
}

function _hideLoader() { const el = document.getElementById('boot-loader'); if (el) el.style.display = 'none'; }
function _showAuth()   { document.getElementById('auth-screen')?.classList.add('active'); }
function _hideAuth()   { document.getElementById('auth-screen')?.classList.remove('active'); }
function _showHome()   { document.getElementById('home-screen')?.classList.add('active'); }

function _initGlobalIntents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-intent]');
    if (!el) return;
    switch (el.dataset.intent) {
      case 'INTENT_LOCK_APP':
        State.dispatch('CRYPTO_LOCK');
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        _showAuth(); UI.showStep('step-lock');
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
      case 'INTENT_RESTORE_BACKUP': {
        const pwd = document.getElementById('backup-pwd')?.value;
        const err = document.getElementById('restore-err');
        const prog = document.getElementById('restore-progress');
        const fileBuf = window._restoreFileBuffer;
        if (!fileBuf) { if (err) err.textContent = 'Seleziona un file .enc'; return; }
        if (!pwd)     { if (err) err.textContent = 'Inserisci la password di backup'; return; }
        if (!confirm('Ripristinare il backup? I dati correnti verranno sovrascritti irreversibilmente.')) return;
        if (err) err.textContent = '';
        if (prog) prog.style.display = 'block';
        el.disabled = true;
        const unsubOk = State.subscribe('BACKUP_RESTORED', ({ recordCount }) => {
          unsubOk(); unsubErr();
          if (prog) prog.style.display = 'none';
          el.disabled = false;
          document.getElementById('restore-panel')?.classList.remove('open');
          alert(`✅ Ripristino completato: ${recordCount} record ripristinati.`);
          location.reload();
        });
        const unsubErr = State.subscribe('RESTORE_ERROR', ({ error }) => {
          unsubOk(); unsubErr();
          if (prog) prog.style.display = 'none';
          el.disabled = false;
          if (err) err.textContent = '❌ ' + error;
        });
        State.dispatch('INTENT_RESTORE_VAULT', { fileBuffer: fileBuf, password: pwd });
        break;
      }
    }
  });
}

function _initZkWorker() {
  let _worker = null;
  const _deadLetterQueue = [];
  State.subscribe('APP_READY', () => {
    if (_deadLetterQueue.length > 0) {
      State.dispatch('ZK_RETRY_QUEUED_JOBS', { jobs: [..._deadLetterQueue] });
      _deadLetterQueue.length = 0;
    }
    if (_worker) return;
    try {
      _worker = new Worker('./zk-worker.js');
      _worker.onmessage = e => {
        if (e.data.type === 'WORKER_READY') State.dispatch('ZK_WORKER_READY');
        else State.dispatch('ZK_WORKER_MESSAGE', e.data);
      };
      _worker.onerror = err => { console.warn('[boot] ZK worker errore:', err.message); _worker = null; };
      document.addEventListener('visibilitychange', () => {
        if (!_worker) return;
        if (document.hidden) { _worker.postMessage({ type: 'APP_BACKGROUND' }); State.dispatch('ZK_PAUSED'); }
        else { _worker.postMessage({ type: 'APP_FOREGROUND' }); State.dispatch('ZK_RESUMED'); }
      });
    } catch (e) { console.warn('[boot] Web Worker non supportato:', e.message); }
  });
  State.subscribe('CRYPTO_LOCKED', () => {
    if (!_worker) return;
    const forceKill = setTimeout(() => { if (_worker) { _worker.terminate(); _worker = null; } }, 2000);
    const onAck = e => {
      if (e.data?.type !== 'SHUTDOWN_ACK') return;
      clearTimeout(forceKill);
      _worker.removeEventListener('message', onAck);
      const pending = e.data.pendingJobs || [];
      if (pending.length > 0) _deadLetterQueue.push(...pending);
      _worker.terminate(); _worker = null;
    };
    _worker.addEventListener('message', onAck);
    _worker.postMessage({ type: 'INTENT_SHUTDOWN' });
  });
}

navigator.serviceWorker?.addEventListener('message', event => {
  if (event.data?.type === 'UPDATE_AVAILABLE') State.dispatch('UPDATE_AVAILABLE');
});

boot();

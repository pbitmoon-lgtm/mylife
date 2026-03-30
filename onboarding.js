// ═══════════════════════════════════════════════════════
// My Life — onboarding.js
// Wizard primo avvio: PIN setup, conferma, 12 parole, verifica.
// Gestisce anche la lock screen PIN e il recovery.
//
// Responsabilità:
//   - Tutto il PIN pad (setup, conferma, lock, recovery)
//   - Visualizzazione 12 parole di backup
//   - Verifica parole
//   - Nessuna variabile globale window.* (tranne l'export)
//
// Comunica SOLO tramite State e Hardware.
// Non tocca DB, crypto, o UI applicativa.
// ═══════════════════════════════════════════════════════

import State    from './state.js';
import Hardware from './hardware.js';
import UI       from './ui.js';

const Onboarding = (() => {

  // ─── STATO INTERNO ────────────────────────────────────
  let _setupPin    = '';
  let _confirmPin  = '';
  let _lockPin     = '';
  let _recovWords  = [];   // 12 parole generate al setup
  let _verifyIdx   = [];   // indici da verificare
  let _pinLocked   = false;
  let _confirming  = false;
  let _recovSeed   = null; // seed recuperato dalle 12 parole

  // ─── WIZARD STEP NAVIGATION ───────────────────────────
  function showWizStep(id) {
    ['step-welcome', 'step-pin', 'step-confirm',
     'step-phrase', 'step-verify']
      .forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = 'none';
      });
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
    if (id === 'step-verify') _buildVerifyUI();
  }

  // ─── SETUP PIN ────────────────────────────────────────
  function setupKey(d) {
    if (_setupPin.length >= 6) return;
    _setupPin += d;
    UI.updateDots('setup-dots', _setupPin.length, false);
    if (_setupPin.length === 6) {
      setTimeout(() => showWizStep('step-confirm'), 200);
    }
  }

  function setupDel() {
    _setupPin = _setupPin.slice(0, -1);
    UI.updateDots('setup-dots', _setupPin.length, false);
  }

  // ─── CONFIRM PIN ──────────────────────────────────────
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
      UI.setText('confirm-sub', '⚙️ Configurazione...');

      try {
        if (_recovSeed) {
          await Hardware.migrateWithPin(_setupPin, _recovSeed);
          _recovSeed = null;
        } else {
          await Hardware.setupWithPin(_setupPin);
        }
      } catch (e) {
        _confirming = false;
        console.error('[onboarding] setup error:', e);
        State.dispatch('SYSTEM_ERROR', { error: 'Errore durante il setup: ' + e.message });
      }
    }
  }

  function confirmDel() {
    if (_confirming) return;
    _confirmPin = _confirmPin.slice(0, -1);
    UI.updateDots('confirm-dots', _confirmPin.length, false);
  }

  // ─── LOCK PIN ─────────────────────────────────────────
  async function lockKey(d) {
    if (_pinLocked || _lockPin.length >= 6) return;
    _lockPin += d;
    UI.updateDots('lock-dots', _lockPin.length, false);

    if (_lockPin.length === 6) {
      _pinLocked = true;
      UI.setText('lock-sub', '🔓 Verifica...');
      try {
        await Hardware.unlockWithPin(_lockPin);
      } catch (e) {
        _pinError();
      }
    }
  }

  function lockDel() {
    if (_pinLocked) return;
    if (_lockPin.length > 0) {
      _lockPin = _lockPin.slice(0, -1);
      UI.updateDots('lock-dots', _lockPin.length, false);
    }
  }

  function _pinError() {
    UI.updateDotsState('lock-dots', 'err');
    UI.setText('lock-sub', 'PIN errato. Riprova.');
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    setTimeout(() => {
      _lockPin = '';
      _pinLocked = false;
      UI.updateDots('lock-dots', 0, false);
      UI.setText('lock-sub', 'La tua privacy, sulla chain, per sempre');
    }, 900);
  }

  // ─── RECOVERY ─────────────────────────────────────────
  function showRecovery() {
    const grid = document.getElementById('rec-grid');
    if (!grid) return;
    grid.innerHTML = Array.from({ length: 12 }, (_, i) =>
      `<div class="rrow">
        <span class="rnum">#${i + 1}</span>
        <input class="rinput" id="rw${i}" placeholder="parola ${i + 1}..."
          autocomplete="off" spellcheck="false" style="text-transform:lowercase">
      </div>`
    ).join('');
    UI.showStep('step-recovery');
  }

  async function doRecovery() {
    const words = Array.from({ length: 12 }, (_, i) => {
      const el = document.getElementById('rw' + i);
      return el ? el.value.trim().toLowerCase() : '';
    });
    const err = document.getElementById('rec-err');
    if (err) { err.style.color = 'var(--text2)'; err.textContent = '🔍 Verifica...'; }
    await Hardware.recoverWithWords(words);
  }

  // ─── 12 PAROLE — VISUALIZZAZIONE ──────────────────────
  function _showPhraseStep(words) {
    _recovWords = words;
    const grid = document.getElementById('phrase-grid');
    if (grid) {
      grid.innerHTML = words.map((w, i) =>
        `<div class="phrase-word">
          <span class="pnum">${String(i + 1).padStart(2, '0')}</span>
          <span class="pword">${w}</span>
        </div>`
      ).join('');
    }
    showWizStep('step-phrase');
    // Reset stato per permettere nuovo setup se l'utente torna indietro
    _confirming = false;
  }

  // ─── VERIFICA PAROLE ──────────────────────────────────
  function _buildVerifyUI() {
    _verifyIdx = [];
    while (_verifyIdx.length < 4) {
      const n = Math.floor(Math.random() * 12);
      if (!_verifyIdx.includes(n)) _verifyIdx.push(n);
    }
    _verifyIdx.sort((a, b) => a - b);

    const grid = document.getElementById('verify-grid');
    if (!grid) return;
    grid.innerHTML = _verifyIdx.map(i =>
      `<div class="rrow">
        <span class="rnum">#${i + 1}</span>
        <input class="rinput" data-i="${i}" placeholder="parola ${i + 1}..."
          autocomplete="off" spellcheck="false">
      </div>`
    ).join('');

    grid.querySelectorAll('.rinput').forEach(inp => {
      inp.addEventListener('input', _checkVerify);
    });
  }

  function _checkVerify() {
    let ok = true;
    document.querySelectorAll('#verify-grid .rinput').forEach(inp => {
      const v = inp.value.trim().toLowerCase();
      if (!v) { inp.className = 'rinput'; ok = false; }
      else if (v === _recovWords[+inp.dataset.i]) inp.className = 'rinput ok';
      else { inp.className = 'rinput err'; ok = false; }
    });
    const btn = document.getElementById('verify-btn');
    if (btn) btn.disabled = !ok;
  }

  function finishSetup() {
    Hardware.markBackupVerified();
  }

  // ─── PIN PAD TOUCH/CLICK ──────────────────────────────
  const KEY_FNS = {
    lockKey, lockDel,
    setupKey, setupDel,
    confirmKey, confirmDel,
  };

  let _lastTouch = 0;

  function _initPinPad() {
    document.addEventListener('touchstart', e => {
      const key = e.target.closest('.key');
      if (!key || key.classList.contains('empty')) return;
      e.preventDefault();
      _lastTouch = Date.now();
      key.classList.add('pressed');
      setTimeout(() => key.classList.remove('pressed'), 120);
      if (navigator.vibrate) navigator.vibrate(8);
      const fn = key.dataset.fn, v = key.dataset.v;
      if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
    }, { passive: false });

    document.addEventListener('click', e => {
      if (Date.now() - _lastTouch < 500) return;
      const key = e.target.closest('.key');
      if (!key || key.classList.contains('empty')) return;
      const fn = key.dataset.fn, v = key.dataset.v;
      if (fn && KEY_FNS[fn]) v ? KEY_FNS[fn](v) : KEY_FNS[fn]();
    });
  }

  // ─── EVENTI STATE ─────────────────────────────────────

  // Ricezione 12 parole dal crypto engine — UNICO punto di ascolto
  State.subscribe('CRYPTO_KEY_DERIVED', ({ isSetup, words }) => {
    if (!isSetup || !words) return;
    _showPhraseStep(words);
  });

  // PIN errato
  State.subscribe('AUTH_FAILED', ({ reason }) => {
    if (reason === 'invalid_words') {
      const err = document.getElementById('rec-err');
      if (err) { err.style.color = 'var(--red)'; err.textContent = '❌ Parole non corrette.'; }
    } else {
      _pinError();
    }
  });

  // Recovery verificata → prepara setup nuovo PIN con seed recuperato
  State.subscribe('AUTH_RECOVERY_VERIFIED', ({ seed }) => {
    _recovSeed = seed;
    UI.setText('pin-sub', 'Scegli un nuovo PIN per questo dispositivo.');
    showWizStep('step-pin');
    // Reset stati PIN per nuovo setup
    _setupPin   = '';
    _confirmPin = '';
    _confirming = false;
    UI.updateDots('setup-dots', 0, false);
  });

  // ─── INIT ─────────────────────────────────────────────
  function init() {
    _initPinPad();
    console.log('[onboarding] modulo pronto');
  }

  // ─── API PUBBLICA ─────────────────────────────────────
  const pub = {
    init,
    showWizStep,
    showRecovery,
    doRecovery,
    finishSetup,
    // Esposti per i pulsanti HTML via data-intent o onclick residui
    setupKey, setupDel,
    confirmKey, confirmDel,
    lockKey, lockDel,
  };

  window.Onboarding = pub;
  return pub;

})();

export default Onboarding;

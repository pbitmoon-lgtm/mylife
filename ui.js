// ═══════════════════════════════════════════════════════
// My Life — ui.js
// Helper UI condivisi. Nessuna logica di business.
// Usato da boot.js e dai moduli UI.
// ═══════════════════════════════════════════════════════

const UI = {

  // ─── SCREENS ────────────────────────────────────────
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  },

  showStep(id) {
    // Tutti gli step possibili — boot.js usa step-lock/setup/recovery
    // wizard usa step-welcome/pin/confirm/phrase/verify
    ['step-welcome','step-pin','step-confirm','step-phrase','step-verify',
     'step-lock','step-setup','step-recovery']
      .forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = 'none';
      });
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'flex';
      if (id === 'step-verify') window.buildVerifyUI?.();
    } else {
      console.error('[ui] showStep: elemento non trovato:', id);
    }
  },

  // ─── ERROR BANNER ────────────────────────────────────
  showError(msg) {
    const b = document.getElementById('err');
    if (b) { b.style.display='block'; b.textContent='⚠️ ' + msg; }
    console.error('[UI ERROR]', msg);
  },

  hideError() {
    const b = document.getElementById('err');
    if (b) b.style.display = 'none';
  },

  // ─── TEXT ─────────────────────────────────────────────
  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  },

  // ─── PIN DOTS ────────────────────────────────────────
  _pinBuffers: { lock: [], setup: [], confirm: [] },

  getPinBuffer(type) {
    return this._pinBuffers[type] || [];
  },

  updateDots(dotId, n, err) {
    const pfx = dotId==='lock-dots'?'d': dotId==='setup-dots'?'s':'c';
    for (let i=0; i<6; i++) {
      const el = document.getElementById(pfx+i);
      if (!el) continue;
      el.className = 'dot' + (err?' err': i<n?' on':'');
    }
  },

  updateDotsState(dotId, state) {
    const pfx = dotId==='lock-dots'?'d': dotId==='setup-dots'?'s':'c';
    for (let i=0; i<6; i++) {
      const el = document.getElementById(pfx+i);
      if (el) el.className = 'dot ' + state;
    }
  },

  // ─── UTILITIES ───────────────────────────────────────
  esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  fmtDate(ts) {
    return new Date(ts).toLocaleDateString('it-IT',{day:'numeric',month:'short'});
  },

  resize(file, maxW) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const r = Math.min(maxW/img.width, 1);
        const c = document.createElement('canvas');
        c.width = img.width*r; c.height = img.height*r;
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        resolve(c.toDataURL('image/jpeg',.8));
      };
      img.src = URL.createObjectURL(file);
    });
  }
};

// Esponi globalmente (usato da boot.js e moduli UI)
window.UI = UI;

export default UI;

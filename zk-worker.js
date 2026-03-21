// ═══════════════════════════════════════════════════════
// My Life — zk-worker.js (PRODUZIONE - RESILIENTE)
// Web Worker isolato per calcolo ZK Proofs (M4)
//
// PROBLEMA RISOLTO — Background Throttling:
//   iOS/Android strozzano setTimeout a 1000ms quando
//   l'app è in background. Una prova da 30s diventa 20min.
//   Soluzione: il Worker si PAUSA quando l'app va in
//   background e RIPRENDE quando torna in primo piano.
//   Il main thread monitora visibilityState e notifica
//   il Worker via postMessage.
// ═══════════════════════════════════════════════════════

const _activeJobs = new Map();
let _shuttingDown = false;
let _paused       = false; // true quando l'app è in background

// ─── MICRO-TASKING CON PAUSA ──────────────────────────
// Esegue in chunk da 50ms. Se il Worker è in pausa (background),
// aspetta che il main thread invii RESUME prima di continuare.
// Previene il battery drain silenzioso da background throttling.
async function runInChunks(fn, chunkMs = 50) {
  return new Promise((resolve, reject) => {
    async function tick() {
      if (_shuttingDown) { reject(new Error('SHUTDOWN')); return; }

      // Pausa se l'app è in background
      if (_paused) {
        await waitForResume();
        if (_shuttingDown) { reject(new Error('SHUTDOWN')); return; }
      }

      const t0 = performance.now();
      try {
        const result = await fn();
        resolve(result);
      } catch (e) {
        if (e.message === 'SHUTDOWN') { reject(e); return; }
        if (performance.now() - t0 < chunkMs) { reject(e); return; }
        setTimeout(tick, 0); // cede il controllo e riprova
      }
    }
    setTimeout(tick, 0);
  });
}

// Attende che _paused diventi false
// Polling a 500ms — accettabile in background
function waitForResume() {
  return new Promise(resolve => {
    const check = setInterval(() => {
      if (!_paused || _shuttingDown) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

// ─── HANDLER MESSAGGI ─────────────────────────────────
self.addEventListener('message', async e => {
  const { type, id, circuit, data } = e.data;

  switch (type) {

    case 'PING':
      self.postMessage({ type: 'PONG', id });
      break;

    // ── Gestione background/foreground ────────────────
    // Il main thread monitora document.visibilityState
    // e notifica il Worker per prevenire background throttling
    case 'APP_BACKGROUND':
      _paused = true;
      console.log('[zk-worker] pausa — app in background');
      self.postMessage({ type: 'WORKER_PAUSED' });
      break;

    case 'APP_FOREGROUND':
      _paused = false;
      console.log('[zk-worker] ripresa — app in primo piano');
      self.postMessage({ type: 'WORKER_RESUMED', activeJobs: _activeJobs.size });
      break;

    // ── Calcolo ZK Proof ──────────────────────────────
    case 'COMPUTE_PROOF': {
      if (_shuttingDown) {
        self.postMessage({ type:'JOB_REJECTED', id, reason:'worker in shutdown' });
        return;
      }

      _activeJobs.set(id, { circuit, data, startedAt: Date.now() });

      try {
        const proof = await runInChunks(async () => ({
          circuit,
          proof:        '0x_PLACEHOLDER_M4',
          publicInputs: [],
          generatedAt:  Date.now(),
        }));

        _activeJobs.delete(id);
        self.postMessage({ type:'PROOF_READY', id, proof });

      } catch (err) {
        _activeJobs.delete(id);
        if (err.message === 'SHUTDOWN') {
          self.postMessage({ type:'JOB_INTERRUPTED', id });
        } else {
          self.postMessage({ type:'PROOF_ERROR', id, error: err.message });
        }
      }
      break;
    }

    // ── Graceful Shutdown ──────────────────────────────
    case 'INTENT_SHUTDOWN': {
      _shuttingDown = true;
      _paused = false; // sblocca waitForResume per permettere shutdown
      console.log(`[zk-worker] graceful shutdown — ${_activeJobs.size} job attivi`);

      await new Promise(r => setTimeout(r, 100));

      const pendingJobs = Array.from(_activeJobs.entries()).map(([jobId, job]) => ({
        id: jobId, circuit: job.circuit, data: job.data,
      }));
      _activeJobs.clear();

      self.postMessage({ type:'SHUTDOWN_ACK', pendingJobs });
      break;
    }

    default:
      self.postMessage({ type:'ERROR', id, error:`Tipo non riconosciuto: ${type}` });
  }
});

self.postMessage({ type: 'WORKER_READY' });

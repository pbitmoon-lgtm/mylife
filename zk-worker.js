// ═══════════════════════════════════════════════════════
// My Life — zk-worker.js
// Web Worker isolato per calcolo ZK Proofs (M4)
//
// Gira in thread separato — non blocca mai la UI.
// Comunica solo tramite postMessage.
// Supporta Graceful Shutdown per evitare Dangling State.
// ═══════════════════════════════════════════════════════

// Registro dei job in corso { id → { circuit, data, startedAt } }
const _activeJobs = new Map();

// Flag di shutdown — quando true, non accetta nuovi job
let _shuttingDown = false;

// ─── MICRO-TASKING ────────────────────────────────────
// Esegue il calcolo in chunk da 50ms per evitare
// thermal throttling su mobile e mantenere l'UI a 60fps.
// Ogni chunk cede il controllo al browser prima di continuare.
async function runInChunks(fn, chunkMs = 50) {
  return new Promise((resolve, reject) => {
    let result;
    async function tick() {
      if (_shuttingDown) { reject(new Error('SHUTDOWN')); return; }
      const t0 = performance.now();
      try {
        result = await fn();
        resolve(result);
      } catch (e) {
        if (e.message === 'SHUTDOWN') reject(e);
        else if (performance.now() - t0 < chunkMs) reject(e);
        else setTimeout(tick, 0); // cede il controllo e riprova
      }
    }
    setTimeout(tick, 0);
  });
}

// ─── HANDLER MESSAGGI ────────────────────────────────
self.addEventListener('message', async e => {
  const { type, id, circuit, data } = e.data;

  switch (type) {

    // ── Health check ────────────────────────────────
    case 'PING':
      self.postMessage({ type: 'PONG', id });
      break;

    // ── Calcolo ZK Proof ────────────────────────────
    case 'COMPUTE_PROOF': {
      if (_shuttingDown) {
        // Rifiuta nuovi job durante shutdown
        self.postMessage({
          type:   'JOB_REJECTED',
          id,
          reason: 'worker in shutdown'
        });
        return;
      }

      // Registra il job come attivo
      _activeJobs.set(id, { circuit, data, startedAt: Date.now() });

      try {
        // TODO M4: implementazione reale con Noir/Aztec WASM
        // Struttura del calcolo:
        //   1. Compila il circuito Noir
        //   2. Genera la prova in micro-chunk da 50ms
        //   3. Restituisce la prova (0x...) al main thread
        const proof = await runInChunks(async () => {
          // Placeholder — simula latenza computazionale
          return {
            circuit,
            proof:     '0x_PLACEHOLDER_M4',
            publicInputs: [],
            generatedAt:  Date.now(),
          };
        });

        _activeJobs.delete(id);
        self.postMessage({ type: 'PROOF_READY', id, proof });

      } catch (err) {
        _activeJobs.delete(id);
        if (err.message === 'SHUTDOWN') {
          // Job interrotto da shutdown — il main thread lo gestirà
          // tramite pendingJobs nell'ACK di shutdown
          self.postMessage({ type: 'JOB_INTERRUPTED', id });
        } else {
          self.postMessage({ type: 'PROOF_ERROR', id, error: err.message });
        }
      }
      break;
    }

    // ── Graceful Shutdown ────────────────────────────
    // Ricevuto da boot.js quando la sessione si blocca.
    // 1. Setta il flag _shuttingDown per bloccare nuovi job
    // 2. Attende che i job attivi vengano interrotti (via SHUTDOWN error)
    // 3. Risponde con SHUTDOWN_ACK + lista dei job pendenti
    //    Il main thread li metterà nella Dead Letter Queue.
    case 'INTENT_SHUTDOWN': {
      _shuttingDown = true;
      console.log(`[zk-worker] graceful shutdown — ${_activeJobs.size} job attivi`);

      // Piccola attesa per permettere ai job in corso di ricevere
      // il flag _shuttingDown e interrompersi con error SHUTDOWN
      await new Promise(r => setTimeout(r, 100));

      // Prepara la lista dei job che non sono stati completati
      const pendingJobs = Array.from(_activeJobs.entries()).map(([jobId, job]) => ({
        id:      jobId,
        circuit: job.circuit,
        data:    job.data,
      }));

      _activeJobs.clear();

      // ACK di shutdown con i job pendenti per la Dead Letter Queue
      self.postMessage({
        type:        'SHUTDOWN_ACK',
        pendingJobs,
      });
      break;
    }

    default:
      self.postMessage({
        type:  'ERROR',
        id,
        error: `Tipo messaggio non riconosciuto: ${type}`
      });
  }
});

// Segnala al main thread che il worker è pronto
self.postMessage({ type: 'WORKER_READY' });

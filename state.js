// ═══════════════════════════════════════════════════════
// My Life — state.js (PRODUZIONE - BLINDATO)
// Event Bus unidirezionale (Pub/Sub) con Error Boundary.
// ═══════════════════════════════════════════════════════

const State = (() => {

  const _listeners = new Map();
  const _queue     = new Map();
  const _history   = [];
  const MAX_HISTORY = 50;

  // Eventi transazionali da NON rigiocare mai (no replay)
  // Hanno requestId specifici — il replay causerebbe race condition
  const NO_QUEUE = new Set([
    'RECORDS_LOAD_STARTED', 'PAYLOAD_DECRYPTED', 'PAYLOAD_ENCRYPTED',
    'RECORD_COMMITTED', 'ASSET_COMMITTED', 'RECORD_DELETED',
    'DECRYPTION_FAILED', 'ENCRYPTION_FAILED', 'STORAGE_WRITE_ERROR',
  ]);

  // ─── ESECUZIONE SICURA DEGLI HANDLER ──────────────────
  // Cattura i crash asincroni dei moduli e avvisa l'app
  async function _safeExecute(eventName, handler, payload) {
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[state] ❌ Crash nel modulo in ascolto di '${eventName}':`, err);
      // Evita loop infiniti se l'errore è già nel sistema di errore
      if (eventName !== 'SYSTEM_ERROR') {
        dispatch('SYSTEM_ERROR', { error: `Errore modulo (${eventName}): ${err.message}` });
      }
    }
  }

  // ─── SUBSCRIBE ────────────────────────────────────────
  function subscribe(eventName, handler) {
    if (!_listeners.has(eventName)) {
      _listeners.set(eventName, []);
    }
    _listeners.get(eventName).push(handler);

    // Replay immediato se l'evento "storico" è già avvenuto
    if (_queue.has(eventName)) {
      const { payload } = _queue.get(eventName);
      Promise.resolve().then(() => _safeExecute(eventName, handler, payload));
    }

    return () => unsubscribe(eventName, handler);
  }

  // ─── SUBSCRIBE ONCE (Anti-Memory Leak) ────────────────
  // Ascolta un evento una volta sola e poi si autodistrugge
  function once(eventName, handler) {
    const unsub = subscribe(eventName, async (payload) => {
      unsub(); // Si scollega immediatamente prima di eseguire
      await handler(payload);
    });
    return unsub;
  }

  // ─── UNSUBSCRIBE ──────────────────────────────────────
  function unsubscribe(eventName, handler) {
    if (!_listeners.has(eventName)) return;
    const filtered = _listeners.get(eventName).filter(h => h !== handler);
    _listeners.set(eventName, filtered);
  }

  // ─── DISPATCH ─────────────────────────────────────────
  function dispatch(eventName, payload = {}) {
    _history.push({ event: eventName, payload, ts: Date.now() });
    if (_history.length > MAX_HISTORY) _history.shift();

    if (eventName === 'SYSTEM_ERROR') console.error(`[state] 🛑 ${eventName}`, payload);
    else console.log(`[state] ▶ ${eventName}`, payload);

    // Solo eventi permanenti (broadcast) vanno in _queue per il replay
    // Gli eventi transazionali (con requestId) non vengono salvati
    if (!NO_QUEUE.has(eventName)) {
      _queue.set(eventName, { payload, ts: Date.now() });
    }

    if (_listeners.has(eventName)) {
      // Clona l'array per evitare bug se un handler fa unsubscribe durante l'iterazione
      const currentListeners = [..._listeners.get(eventName)];
      currentListeners.forEach(handler => {
        Promise.resolve().then(() => _safeExecute(eventName, handler, payload));
      });
    }
  }

  // ─── GETTERS ──────────────────────────────────────────
  function getState(eventName) {
    return _queue.get(eventName)?.payload || null;
  }

  function getHistory() {
    return [..._history];
  }

  return { subscribe, once, unsubscribe, dispatch, getState, getHistory };

})();

export default State;

// ═══════════════════════════════════════════════════════
// My Life — state.js
// Event Bus unidirezionale (Pub/Sub).
// È l'UNICO canale di comunicazione tra moduli.
// Nessun modulo importa un altro modulo direttamente.
// Tutti i moduli importano solo state.js.
//
// Pattern:
//   Modulo A → State.dispatch('EVENTO', payload)
//   Modulo B → State.subscribe('EVENTO', handler)
//
// Flusso principale:
//   hardware.js → AUTH_SUCCESS_PRF
//   crypto.js   → CRYPTO_KEY_DERIVED
//   db.js       → STORAGE_MOUNTED
//   boot.js     → APP_READY
// ═══════════════════════════════════════════════════════

const State = (() => {

  // Registro dei listener: { eventName: [handler, handler...] }
  const _listeners = new Map();

  // Coda per eventi emessi prima che i listener fossero registrati
  // Risolve race conditions durante il boot
  const _queue = new Map();

  // Log di tutti gli eventi (debug)
  const _history = [];
  const MAX_HISTORY = 50;

  // ─── SUBSCRIBE ────────────────────────────────────────
  // Registra un handler per un evento.
  // Se l'evento era già stato emesso (boot), lo esegue subito.
  function subscribe(eventName, handler) {
    if (!_listeners.has(eventName)) {
      _listeners.set(eventName, []);
    }
    _listeners.get(eventName).push(handler);

    // Se questo evento è già stato emesso durante il boot,
    // esegui subito l'handler con il payload salvato
    if (_queue.has(eventName)) {
      const { payload } = _queue.get(eventName);
      Promise.resolve().then(() => handler(payload));
    }

    return () => unsubscribe(eventName, handler); // ritorna unsubscribe
  }

  // ─── UNSUBSCRIBE ──────────────────────────────────────
  function unsubscribe(eventName, handler) {
    if (!_listeners.has(eventName)) return;
    const filtered = _listeners.get(eventName).filter(h => h !== handler);
    _listeners.set(eventName, filtered);
  }

  // ─── DISPATCH ─────────────────────────────────────────
  // Emette un evento con payload opzionale.
  // Tutti i listener registrati vengono notificati.
  function dispatch(eventName, payload = {}) {
    // Log per debug
    _history.push({ event: eventName, payload, ts: Date.now() });
    if (_history.length > MAX_HISTORY) _history.shift();
    console.log(`[state] ▶ ${eventName}`, payload);

    // Salva nella coda per listener che si registreranno dopo
    // (utile per eventi di boot come STORAGE_MOUNTED)
    _queue.set(eventName, { payload, ts: Date.now() });

    // Notifica tutti i listener registrati
    if (_listeners.has(eventName)) {
      _listeners.get(eventName).forEach(handler => {
        Promise.resolve().then(() => handler(payload));
      });
    }
  }

  // ─── GET STATE ────────────────────────────────────────
  // Legge l'ultimo payload di un evento (stato corrente).
  function getState(eventName) {
    return _queue.get(eventName)?.payload || null;
  }

  // ─── HISTORY (debug) ──────────────────────────────────
  function getHistory() {
    return [..._history];
  }

  return { subscribe, unsubscribe, dispatch, getState, getHistory };

})();

export default State;

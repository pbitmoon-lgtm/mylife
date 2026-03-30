// ═══════════════════════════════════════════════════════
// My Life — navigation.js
// Gestione navigazione tra schermate e sezioni.
// Centralizza tutta la logica di apertura/chiusura UI.
//
// Responsabilità:
//   - Apertura/chiusura sezioni (Note, Mappa, Chat, ecc.)
//   - Aggiornamento orologio home
//   - Gestione back gesture (popstate)
//   - Nessuna logica di business
// ═══════════════════════════════════════════════════════

import State from './state.js';

const Navigation = (() => {

  // ─── APERTURA SEZIONI ─────────────────────────────────

  function openMap() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('map-screen').classList.add('active');
    setTimeout(() => {
      window.MapModule?.init();
      window.MapModule?.invalidate?.();
    }, 300);
  }

  function openNotes() {
    document.getElementById('notes-screen').classList.add('open');
    document.getElementById('notes-fab').classList.add('visible');
    window.NotesModule?.load();
  }

  function openChat() {
    document.getElementById('chat-screen').classList.add('open');
  }

  function openSettings() {
    document.getElementById('settings-screen').classList.add('open');
  }

  function openCalendar() {
    document.getElementById('calendar-screen').classList.add('open');
    window.CalendarModule?.load();
  }

  function closeSection(id) {
    document.getElementById(id)?.classList.remove('open');
    document.getElementById('notes-fab')?.classList.remove('visible');
    if (id === 'map-screen') {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('home-screen').classList.add('active');
    }
  }

  // ─── OROLOGIO HOME ────────────────────────────────────

  function _updateHomeTime() {
    const el = document.getElementById('home-time');
    if (!el) return;
    const n = new Date();
    el.textContent =
      n.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) +
      ' · ' +
      n.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ─── BACK GESTURE ────────────────────────────────────

  function _initBackGesture() {
    window.addEventListener('popstate', () => {
      [
        'notes-screen', 'chat-screen', 'settings-screen',
        'calendar-screen', 'trips-panel', 'fav-modal', 'cal-event-form',
      ].forEach(id => {
        document.getElementById(id)?.classList.remove('open');
      });
      document.getElementById('note-editor')?.classList.remove('open');
      document.getElementById('notes-fab')?.classList.remove('visible');
    });
    history.pushState({}, '');
  }

  // ─── EVENTI STATE ─────────────────────────────────────

  State.subscribe('APP_READY', () => {
    _updateHomeTime();
    setInterval(_updateHomeTime, 30000);
    console.log('[navigation] modulo pronto');
  });

  // ─── INIT ─────────────────────────────────────────────

  function init() {
    _initBackGesture();
  }

  // ─── API PUBBLICA ─────────────────────────────────────
  const pub = {
    init,
    openMap, openNotes, openChat, openSettings, openCalendar,
    closeSection,
  };

  window.Navigation = pub;
  return pub;

})();

export default Navigation;

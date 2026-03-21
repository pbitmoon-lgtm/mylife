// ═══════════════════════════════════════════════════════
// My Life — calendar.js  v1.0
// Calendario con appuntamenti collegabili a note e luoghi
// Tipo record: 'appointment'
// ═══════════════════════════════════════════════════════

import State from './state.js';
import UI    from './ui.js';

const CalendarModule = (() => {

  // ─── STATO ────────────────────────────────────────────
  let _today     = new Date();
  let _viewYear  = _today.getFullYear();
  let _viewMonth = _today.getMonth(); // 0-11
  let _events    = []; // tutti gli appuntamenti caricati
  let _editingId = null; // id evento in modifica (null = nuovo)

  const MONTHS_IT = [
    'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'
  ];
  const DAYS_IT = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

  // ─── CARICA EVENTI ────────────────────────────────────
  function load() {
    _events = [];
    State.dispatch('INTENT_LOAD_RECORDS', {
      type:      'appointment',
      requestId: 'cal_load',
    });
  }

  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset, requestId }) => {
    if (isAsset || !payload || requestId !== 'cal_load') return;
    if (payload.type !== 'appointment') return;
    _events.push({ ...payload, id });
    renderCalendar();
  });

  State.subscribe('RECORDS_LOAD_STARTED', ({ type, count, requestId }) => {
    if (requestId === 'cal_load' && count === 0) renderCalendar();
  });

  // ─── RENDER CALENDARIO ────────────────────────────────
  function renderCalendar() {
    const grid = document.getElementById('cal-grid');
    const hdr  = document.getElementById('cal-month-title');
    if (!grid || !hdr) return;

    hdr.textContent = `${MONTHS_IT[_viewMonth]} ${_viewYear}`;

    // Costruisci griglia giorni
    const firstDay  = new Date(_viewYear, _viewMonth, 1);
    const lastDay   = new Date(_viewYear, _viewMonth + 1, 0);
    const startDow  = (firstDay.getDay() + 6) % 7; // Lun=0
    const totalDays = lastDay.getDate();

    // Header giorni
    const dayHeaders = DAYS_IT.map(d =>
      `<div class="cal-day-hdr">${d}</div>`
    ).join('');

    // Celle vuote prima del primo giorno
    const emptyCells = Array(startDow).fill('<div class="cal-cell empty"></div>').join('');

    // Celle giorni
    const todayStr = `${_today.getFullYear()}-${_today.getMonth()}-${_today.getDate()}`;
    let cells = '';
    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${_viewYear}-${_viewMonth}-${d}`;
      const isToday = dateStr === todayStr;

      // Trova eventi per questo giorno
      const dayEvents = _events.filter(e => {
        if (!e.date) return false;
        const ed = new Date(e.date);
        return ed.getFullYear() === _viewYear &&
               ed.getMonth()    === _viewMonth &&
               ed.getDate()     === d;
      });

      const dots = dayEvents.slice(0, 3).map(e =>
        `<div class="cal-dot" style="background:${e.color||'var(--accent)'}"></div>`
      ).join('');

      cells += `<div class="cal-cell${isToday?' today':''}"
        onclick="CalendarModule.openDay(${_viewYear},${_viewMonth},${d})">
        <div class="cal-day-num${isToday?' today':''}">${d}</div>
        <div class="cal-dots">${dots}</div>
      </div>`;
    }

    grid.innerHTML = dayHeaders + emptyCells + cells;

    // Aggiorna lista eventi del mese
    renderMonthList();
  }

  // ─── LISTA EVENTI DEL MESE ────────────────────────────
  function renderMonthList() {
    const list = document.getElementById('cal-event-list');
    if (!list) return;

    const monthEvents = _events
      .filter(e => {
        if (!e.date) return false;
        const d = new Date(e.date);
        return d.getFullYear() === _viewYear && d.getMonth() === _viewMonth;
      })
      .sort((a,b) => new Date(a.date) - new Date(b.date));

    if (!monthEvents.length) {
      list.innerHTML = '<div class="no-items" style="padding:20px 0">Nessun appuntamento questo mese</div>';
      return;
    }

    list.innerHTML = monthEvents.map(e => {
      const d    = new Date(e.date);
      const ds   = d.toLocaleDateString('it-IT', {weekday:'short', day:'numeric', month:'short'});
      const time = e.time || '';
      return `<div class="cal-event-item" onclick="CalendarModule.editEvent(${e.id})">
        <div class="cal-event-dot" style="background:${e.color||'var(--accent)'}"></div>
        <div class="cal-event-info">
          <div class="cal-event-title">${UI.esc(e.title||'Appuntamento')}</div>
          <div class="cal-event-meta">
            ${ds}${time ? ` · ${time}` : ''}
            ${e.linkedNote ? ' · 📓' : ''}
            ${e.linkedPlace ? ' · 📍' : ''}
          </div>
        </div>
        <div class="cal-event-del" onclick="event.stopPropagation();CalendarModule.deleteEvent(${e.id})">✕</div>
      </div>`;
    }).join('');
  }

  // ─── NAVIGAZIONE MESE ─────────────────────────────────
  function prevMonth() {
    if (_viewMonth === 0) { _viewMonth = 11; _viewYear--; }
    else _viewMonth--;
    renderCalendar();
  }

  function nextMonth() {
    if (_viewMonth === 11) { _viewMonth = 0; _viewYear++; }
    else _viewMonth++;
    renderCalendar();
  }

  function goToday() {
    _viewYear  = _today.getFullYear();
    _viewMonth = _today.getMonth();
    renderCalendar();
  }

  // ─── APRI GIORNO ──────────────────────────────────────
  function openDay(year, month, day) {
    // Pre-compila la data nel form
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    openEventForm(null, dateStr);
  }

  // ─── FORM NUOVO/MODIFICA EVENTO ───────────────────────
  function openEventForm(id, prefillDate) {
    _editingId = id || null;
    const form = document.getElementById('cal-event-form');
    if (!form) return;

    if (id) {
      // Modifica evento esistente
      const ev = _events.find(e => e.id === id);
      if (!ev) return;
      document.getElementById('cal-ev-title').value  = ev.title || '';
      document.getElementById('cal-ev-date').value   = ev.date  || '';
      document.getElementById('cal-ev-time').value   = ev.time  || '';
      document.getElementById('cal-ev-notes').value  = ev.notes || '';
      document.getElementById('cal-ev-color').value  = ev.color || '#6c8eff';
      _setLinkedNote(ev.linkedNote || null);
      _setLinkedPlace(ev.linkedPlace || null);
    } else {
      // Nuovo evento
      document.getElementById('cal-ev-title').value  = '';
      document.getElementById('cal-ev-date').value   = prefillDate || _todayStr();
      document.getElementById('cal-ev-time').value   = '';
      document.getElementById('cal-ev-notes').value  = '';
      document.getElementById('cal-ev-color').value  = '#6c8eff';
      _setLinkedNote(null);
      _setLinkedPlace(null);
    }

    form.classList.add('open');
    document.getElementById('cal-ev-title').focus();
  }

  function closeEventForm() {
    document.getElementById('cal-event-form')?.classList.remove('open');
    _editingId = null;
  }

  function editEvent(id) {
    openEventForm(id, null);
  }

  // ─── SALVA EVENTO ─────────────────────────────────────
  function saveEvent() {
    const title = document.getElementById('cal-ev-title')?.value.trim();
    const date  = document.getElementById('cal-ev-date')?.value;
    if (!title) { document.getElementById('cal-ev-title')?.focus(); return; }
    if (!date)  { document.getElementById('cal-ev-date')?.focus(); return; }

    const id = _editingId || Date.now();
    const ev = {
      id,
      type:        'appointment',
      title,
      date,
      time:        document.getElementById('cal-ev-time')?.value || '',
      notes:       document.getElementById('cal-ev-notes')?.value.trim() || '',
      color:       document.getElementById('cal-ev-color')?.value || '#6c8eff',
      linkedNote:  _currentLinkedNote,
      linkedPlace: _currentLinkedPlace,
      createdAt:   _editingId ? (_events.find(e=>e.id===_editingId)?.createdAt||Date.now()) : Date.now(),
      updatedAt:   Date.now(),
    };

    State.dispatch('INTENT_SAVE_RECORD', {
      recordId:    id,
      type:        'appointment',
      textPayload: ev,
    });

    // Aggiorna cache locale
    const idx = _events.findIndex(e => e.id === id);
    if (idx >= 0) _events[idx] = ev;
    else _events.push(ev);

    closeEventForm();
    renderCalendar();
  }

  // ─── ELIMINA EVENTO ───────────────────────────────────
  function deleteEvent(id) {
    if (!confirm('Eliminare questo appuntamento?')) return;
    State.dispatch('INTENT_DELETE_RECORD', { id });
    _events = _events.filter(e => e.id !== id);
    renderCalendar();
  }

  // ─── COLLEGAMENTO NOTA ────────────────────────────────
  let _currentLinkedNote  = null;
  let _currentLinkedPlace = null;

  function _setLinkedNote(note) {
    _currentLinkedNote = note;
    const el = document.getElementById('cal-linked-note');
    if (!el) return;
    el.innerHTML = note
      ? `<span class="cal-link-badge">📓 ${UI.esc(note.title||'Nota')}</span>
         <button class="cal-link-remove" onclick="CalendarModule.removeLinkedNote()">✕</button>`
      : `<button class="cal-link-add" onclick="CalendarModule.pickNote()">+ Collega nota</button>`;
  }

  function _setLinkedPlace(place) {
    _currentLinkedPlace = place;
    const el = document.getElementById('cal-linked-place');
    if (!el) return;
    el.innerHTML = place
      ? `<span class="cal-link-badge">📍 ${UI.esc(place.name||'Luogo')}</span>
         <button class="cal-link-remove" onclick="CalendarModule.removeLinkedPlace()">✕</button>`
      : `<button class="cal-link-add" onclick="CalendarModule.pickPlace()">+ Collega luogo</button>`;
  }

  function removeLinkedNote()  { _setLinkedNote(null); }
  function removeLinkedPlace() { _setLinkedPlace(null); }

  // Picker nota — mostra lista note disponibili
  function pickNote() {
    const picker = document.getElementById('cal-note-picker');
    if (!picker) return;

    // Richiedi le note disponibili
    const notes = [];
    const unsub = State.subscribe('PAYLOAD_DECRYPTED', ({ payload, isAsset, requestId }) => {
      if (isAsset || !payload || requestId !== 'cal_pick_notes') return;
      if (payload.type === 'note') notes.push(payload);
    });

    State.subscribe('RECORDS_LOAD_STARTED', ({ type, count, requestId }) => {
      if (requestId !== 'cal_pick_notes') return;
      unsub();
      setTimeout(() => {
        picker.innerHTML = notes.length
          ? notes.map(n => `
              <div class="cal-pick-item" onclick="CalendarModule.selectNote(${JSON.stringify(JSON.stringify({id:n.id||0,title:n.title||'Nota'}))})">
                📓 ${UI.esc(n.title||'Nota senza titolo')}
              </div>`).join('')
          : '<div class="no-items">Nessuna nota disponibile</div>';
        picker.style.display = 'block';
      }, 300);
    });

    State.dispatch('INTENT_LOAD_RECORDS', { type:'note', requestId:'cal_pick_notes' });
  }

  function selectNote(noteJson) {
    const note = JSON.parse(noteJson);
    _setLinkedNote(note);
    document.getElementById('cal-note-picker').style.display = 'none';
  }

  // Picker luogo — usa i preferiti dalla mappa
  function pickPlace() {
    const picker = document.getElementById('cal-place-picker');
    if (!picker) return;

    // Prendi i preferiti già in cache nel MapModule
    const favs = window.MapModule?.getFavsForCalendar?.() || [];
    picker.innerHTML = favs.length
      ? favs.map(f => `
          <div class="cal-pick-item" onclick="CalendarModule.selectPlace(${JSON.stringify(JSON.stringify({id:f.id,name:f.name,icon:f.icon,lat:f.lat,lng:f.lng}))})">
            ${f.icon||'📍'} ${UI.esc(f.name)}
          </div>`).join('')
      : '<div class="no-items">Nessun luogo salvato nella mappa</div>';
    picker.style.display = 'block';
  }

  function selectPlace(placeJson) {
    const place = JSON.parse(placeJson);
    _setLinkedPlace(place);
    document.getElementById('cal-place-picker').style.display = 'none';
  }

  // ─── UTILS ────────────────────────────────────────────
  function _todayStr() {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }

  State.subscribe('APP_READY', () => {
    console.log('[calendar] modulo pronto');
    load();
  });

  // API pubblica
  const pub = {
    load, renderCalendar, prevMonth, nextMonth, goToday,
    openDay, openEventForm, closeEventForm, editEvent, saveEvent, deleteEvent,
    pickNote, selectNote, pickPlace, selectPlace,
    removeLinkedNote, removeLinkedPlace,
  };
  window.CalendarModule = pub;
  return pub;

})();

export default CalendarModule;

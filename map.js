// ═══════════════════════════════════════════════════════
// My Life — map.js  v2.0
// M1.0 + M1.1: GPS Tracker + Localizzami + Preferiti + Import
// ═══════════════════════════════════════════════════════

import State from './state.js';
import UI    from './ui.js';

const MapModule = (() => {

  // ─── STATO INTERNO ────────────────────────────────────
  let _map       = null;
  let _poly      = null;
  let _markers   = [];   // marker viaggio corrente
  let _favMks    = [];   // marker preferiti
  let _curMk     = null; // posizione corrente
  let _userMk    = null; // marker localizzami
  let _tracking  = false;
  let _trip      = null;
  let _lastPos   = null;
  let _totalDist = 0;
  let _startTime = null;
  let _timerInt  = null;
  let _watchId   = null;
  let _favMode   = false;
  let _pendFav   = null;
  let _selIcon   = '📍';
  let _panelTab  = 'trips';
  let _sens      = 'medium';
  let _auto      = false;

  // Cache separata per panel — popolata solo da requestId specifici
  let _panelTrips = [];
  let _panelFavs  = [];
  let _panelReady = false;

  const SENS = { low: 200, medium: 80, high: 25 };

  // ─── INIT MAPPA ───────────────────────────────────────
  function init() {
    const container = document.getElementById('map');
    if (!container) { console.error('[map] #map container non trovato'); return; }

    if (_map) {
      // Mappa già inizializzata — forza resize e controlla tile
      _map.invalidateSize();
      console.log('[map] invalidateSize chiamato');
      return;
    }

    console.log('[map] inizializzazione Leaflet...');
    console.log('[map] container size:', container.offsetWidth, 'x', container.offsetHeight);

    _map = L.map('map', {
      zoomControl:       false,
      attributionControl: false,
    }).setView([45.46, 9.19], 13);

    // Tile layer OpenStreetMap
    // Il filtro dark-mode è applicato via CSS direttamente su #map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(_map);

    _poly = L.polyline([], { color:'#6c8eff', weight:4, opacity:.85 }).addTo(_map);
    _map.on('click', e => { if (_favMode) openFavModal(e.latlng); });

    _loadFavorites();
    console.log('[map] Leaflet inizializzato');
  }

  function _loadFavorites() {
    State.dispatch('INTENT_LOAD_RECORDS', {
      type:      'favorite',
      requestId: 'map_init_favs',
    });
  }

  // ─── GESTORI EVENTI PAYLOAD ───────────────────────────
  // UN SOLO subscribe per PAYLOAD_DECRYPTED — smista per requestId e tipo
  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset, requestId }) => {
    if (isAsset || !payload) return;

    switch (requestId) {
      // Caricamento iniziale preferiti → marker sulla mappa
      case 'map_init_favs':
        if (payload.type === 'favorite' && _map) addFavMarker(payload);
        break;

      // Panel viaggi
      case 'map_panel_trips':
        if (payload.type === 'trip') _panelTrips.push(payload);
        break;

      // Panel preferiti
      case 'map_panel_favs':
        if (payload.type === 'favorite') _panelFavs.push(payload);
        break;

      // Nessun requestId riconosciuto → ignora (altri moduli)
      default:
        break;
    }
  });

  // Ascolta completamento caricamento per renderizzare il panel
  State.subscribe('RECORDS_LOAD_STARTED', ({ type, count, requestId }) => {
    if (requestId === 'map_panel_trips' || requestId === 'map_panel_favs') {
      // Se non ci sono record, renderizza subito
      if (count === 0) {
        _panelReady = true;
        setTimeout(renderPanel, 50);
      }
    }
  });

  // ─── GPS TRACKING ─────────────────────────────────────
  function toggleTrip() { _tracking ? stopTrip() : startTrip(); }

  function startTrip() {
    if (!navigator.geolocation) {
      UI.showError('GPS non disponibile su questo dispositivo');
      return;
    }
    _tracking  = true;
    _trip      = { id: Date.now(), points: [], startTime: Date.now() };
    _lastPos   = null;
    _totalDist = 0;
    _startTime = Date.now();

    // Pulisci marker viaggio precedente
    _poly.setLatLngs([]);
    _markers.forEach(m => _map.removeLayer(m));
    _markers = [];

    _setUI({ dot:'rec', stats:true, btn:'rec', icon:'■', label:'Ferma' });
    setStatus('Ricerca GPS...', 'wait');

    _timerInt = setInterval(updTimer, 1000);
    _watchId  = navigator.geolocation.watchPosition(
      onPos,
      err => {
        console.warn('[map] GPS error:', err.code);
        setStatus('GPS non disponibile', 'wait');
      },
      { enableHighAccuracy:true, maximumAge:5000, timeout:15000 }
    );
  }

  function stopTrip() {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    clearInterval(_timerInt);
    _tracking = false;

    _setUI({ dot:'', stats:false, btn:'', icon:'▶', label:'Inizia viaggio' });
    setStatus('Pronto', '');
    const accEl = document.getElementById('gps-acc');
    if (accEl) accEl.textContent = '';

    if (_trip && _trip.points.length > 0) {
      _trip.endTime = Date.now();
      State.dispatch('INTENT_SAVE_RECORD', {
        recordId:    _trip.id,
        type:        'trip',
        textPayload: { ..._trip },
      });
      console.log(`[map] viaggio salvato: ${_trip.points.length} punti`);
    }
    _trip = null;
  }

  function _setUI({ dot, stats, btn, icon, label }) {
    const dotEl   = document.getElementById('mdot');
    const statsEl = document.getElementById('trip-stats');
    const btnEl   = document.getElementById('main-btn');
    const iconEl  = document.getElementById('btn-icon');
    const labelEl = document.getElementById('btn-label');
    if (dotEl)   dotEl.className   = dot ? `mdot ${dot}` : 'mdot';
    if (statsEl) statsEl.className = stats ? 'show' : '';
    if (btnEl)   btnEl.className   = btn;
    if (iconEl)  iconEl.textContent  = icon;
    if (labelEl) labelEl.textContent = label;
  }

  function onPos(pos) {
    const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords;

    const accEl = document.getElementById('gps-acc');
    if (accEl) accEl.textContent = `±${Math.round(acc)}m`;

    // Aggiorna marker posizione corrente
    if (_curMk) _map.removeLayer(_curMk);
    _curMk = L.circleMarker([lat,lng], {
      radius:8, fillColor:'#6c8eff', color:'#fff', weight:2, fillOpacity:1
    }).addTo(_map);

    if (_map.getZoom() < 15) _map.setView([lat,lng], 16);
    else _map.panTo([lat,lng]);

    setStatus('Registrazione', 'active');

    if (!_lastPos) {
      savePoint(lat, lng, acc);
      return;
    }
    const dist = hav(_lastPos.lat, _lastPos.lng, lat, lng);
    if (dist >= SENS[_sens]) {
      savePoint(lat, lng, acc);
    }
  }

  function savePoint(lat, lng, acc) {
    if (!_trip) return;
    const pt = { lat, lng, acc, ts: Date.now() };
    _trip.points.push(pt);
    if (_lastPos) _totalDist += hav(_lastPos.lat, _lastPos.lng, lat, lng);
    _lastPos = { lat, lng };

    _poly.setLatLngs(_trip.points.map(p => [p.lat, p.lng]));

    const i   = _trip.points.length - 1;
    const cls = i === 0 ? ' first' : '';
    const ico = L.divIcon({
      html:      `<div class="gs-dot${cls}"></div>`,
      iconSize:  [12,12], iconAnchor:[6,6], className:''
    });
    const time = new Date(pt.ts).toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'});
    _markers.push(
      L.marker([lat,lng], { icon:ico }).addTo(_map)
        .bindPopup(`<div class="pop-t">${time}</div>
          <div class="pop-s">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`)
    );
    updStats();
  }

  function updStats() {
    const ptsEl  = document.getElementById('s-pts');
    const distEl = document.getElementById('s-dist');
    if (ptsEl)  ptsEl.textContent  = _trip ? _trip.points.length : 0;
    if (distEl) {
      const d = _totalDist;
      distEl.textContent = d >= 1000 ? `${(d/1000).toFixed(1)}km` : `${Math.round(d)}m`;
    }
  }

  function updTimer() {
    const el = document.getElementById('s-time');
    if (!el) return;
    const s = Math.floor((Date.now() - _startTime) / 1000);
    el.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  // ─── LOCALIZZAMI ──────────────────────────────────────
  function locateMe() {
    if (!navigator.geolocation) { UI.showError('GPS non disponibile'); return; }
    const btn = document.getElementById('locate-btn');
    if (btn) btn.textContent = '⌛';

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords;
        if (_userMk) _map.removeLayer(_userMk);
        _userMk = L.marker([lat,lng], {
          icon: L.divIcon({
            html:'<div class="userdot"></div>',
            iconSize:[16,16], iconAnchor:[8,8], className:''
          })
        }).addTo(_map)
          .bindPopup(`<div class="pop-t">📍 Sei qui</div>
            <div class="pop-s">±${Math.round(acc)}m</div>`);

        _map.flyTo([lat,lng], Math.max(_map.getZoom(), 16), { duration:1.2 });
        if (btn) btn.textContent = '📍';
        setStatus(`±${Math.round(acc)}m`, 'active');
        setTimeout(() => {
          if (!_tracking) setStatus('Pronto', '');
          if (btn) btn.textContent = '📍';
        }, 3000);
      },
      () => {
        if (btn) btn.textContent = '📍';
        UI.showError('Impossibile ottenere la posizione GPS');
      },
      { enableHighAccuracy:true, timeout:10000 }
    );
  }

  // ─── PREFERITI ────────────────────────────────────────
  function toggleFav() {
    _favMode = !_favMode;
    const btn = document.getElementById('fav-toggle-btn');
    if (btn) {
      btn.style.background = _favMode ? 'rgba(245,200,66,.2)' : '';
      btn.textContent      = _favMode ? '✕' : '⭐';
    }
    setStatus(_favMode ? 'Tocca la mappa per salvare un luogo' : 'Pronto',
              _favMode ? 'wait' : '');
  }

  function openFavModal(latlng) {
    _pendFav = latlng;
    _selIcon = '📍';
    document.querySelectorAll('.mm-icon').forEach(e =>
      e.classList.toggle('sel', e.dataset.i === '📍'));
    const nameEl = document.getElementById('fav-name-in');
    const noteEl = document.getElementById('fav-note-in');
    if (nameEl) nameEl.value = '';
    if (noteEl) noteEl.value = '';
    document.getElementById('fav-modal')?.classList.add('open');
  }

  function closeFavModal() {
    document.getElementById('fav-modal')?.classList.remove('open');
    if (_favMode) toggleFav(); // disattiva modalità fav
  }

  function selIcon(el) {
    document.querySelectorAll('.mm-icon').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    _selIcon = el.dataset.i;
  }

  function saveFav() {
    const name = document.getElementById('fav-name-in')?.value.trim();
    if (!name) { document.getElementById('fav-name-in')?.focus(); return; }
    const note = document.getElementById('fav-note-in')?.value.trim() || '';
    const id   = Date.now();
    const fav  = {
      id, lat:_pendFav.lat, lng:_pendFav.lng,
      name, note, icon:_selIcon, ts:Date.now(), type:'favorite'
    };
    State.dispatch('INTENT_SAVE_RECORD', {
      recordId: id, type:'favorite', textPayload: fav
    });
    addFavMarker(fav);
    closeFavModal();
  }

  function addFavMarker(fav) {
    if (!_map || !fav.lat || !fav.lng) return;
    const ico = L.divIcon({
      html:     `<div class="fav-mk">${fav.icon||'📍'}</div>`,
      iconSize: [30,30], iconAnchor:[15,15], className:''
    });
    const mk = L.marker([fav.lat, fav.lng], { icon:ico }).addTo(_map)
      .bindPopup(`
        <div class="pop-t">${UI.esc(fav.name)}</div>
        ${fav.note ? `<div class="pop-s">${UI.esc(fav.note)}</div>` : ''}
        <div class="pop-s" style="margin-top:4px">
          ${fav.lat.toFixed(4)}, ${fav.lng.toFixed(4)}
        </div>`);
    _favMks.push(mk);
    return mk;
  }

  // Restituisce i preferiti come oggetti per il calendario
  function getFavsForCalendar() {
    return _panelFavs.map(f => ({
      id:   f.id,
      name: f.name,
      icon: f.icon || '📍',
      lat:  f.lat,
      lng:  f.lng,
    }));
  }

  // ─── PANEL VIAGGI / PREFERITI ─────────────────────────
  function openPanel() {
    _panelTrips = [];
    _panelFavs  = [];
    _panelReady = false;

    document.getElementById('trips-panel')?.classList.add('open');

    // Carica entrambi i tipi con requestId dedicati
    State.dispatch('INTENT_LOAD_RECORDS', {
      type:'trip',     requestId:'map_panel_trips'
    });
    State.dispatch('INTENT_LOAD_RECORDS', {
      type:'favorite', requestId:'map_panel_favs'
    });

    // Renderizza dopo attesa decifratura
    setTimeout(() => {
      _panelReady = true;
      renderPanel();
    }, 500);
  }

  function closePanel() {
    document.getElementById('trips-panel')?.classList.remove('open');
  }

  function switchTab(tab) {
    _panelTab = tab;
    const tripsTab = document.getElementById('sptab-trips');
    const favsTab  = document.getElementById('sptab-favs');
    if (tripsTab) tripsTab.className = `sp-tab${tab==='trips'?' active':''}`;
    if (favsTab)  favsTab.className  = `sp-tab${tab==='favs'?' active':''}`;
    renderPanel();
  }

  function renderPanel() {
    const body = document.getElementById('trips-body');
    if (!body) return;

    if (_panelTab === 'trips') {
      const trips = [..._panelTrips].sort((a,b) =>
        (b.startTime||b.id) - (a.startTime||a.id));
      if (!trips.length) {
        body.innerHTML = '<div class="no-items">Nessun viaggio registrato</div>';
        return;
      }
      body.innerHTML = trips.map(t => {
        const d   = new Date(t.startTime || t.id || Date.now());
        const ds  = d.toLocaleDateString('it-IT', {day:'numeric',month:'short',year:'numeric'});
        const dur = t.endTime ? Math.floor((t.endTime-t.startTime)/60000) : '—';
        const pts = t.points || [];
        let dist  = 0;
        for (let j=1; j<pts.length; j++)
          dist += hav(pts[j-1].lat, pts[j-1].lng, pts[j].lat, pts[j].lng);
        const dm = dist>=1000 ? `${(dist/1000).toFixed(1)}km` : `${Math.round(dist)}m`;
        return `<div class="trip-card" onclick="MapModule.showTrip(${t.id})">
          <div class="trip-card-head">
            <div class="trip-name">📍 ${ds}</div>
            <div class="trip-date">${dur}min</div>
          </div>
          <div class="trip-meta">
            <span>Punti: <b>${pts.length}</b></span>
            <span>Distanza: <b>${dm}</b></span>
          </div>
        </div>`;
      }).join('');
    } else {
      const favs = [..._panelFavs].sort((a,b) => (b.ts||b.id) - (a.ts||a.id));
      if (!favs.length) {
        body.innerHTML = '<div class="no-items">Nessun preferito salvato</div>';
        return;
      }
      body.innerHTML = favs.map(f => `
        <div class="fav-card">
          <div class="fav-ico">${f.icon||'📍'}</div>
          <div class="fav-info">
            <div class="fav-name">${UI.esc(f.name||'')}</div>
            <div class="fav-coord">${(f.lat||0).toFixed(4)}, ${(f.lng||0).toFixed(4)}</div>
            ${f.note ? `<div class="fav-note">${UI.esc(f.note)}</div>` : ''}
          </div>
          <div class="fav-acts">
            <div class="fav-act" title="Vai al luogo"
              onclick="MapModule.goFav(${f.lat},${f.lng})">🎯</div>
          </div>
        </div>`).join('');
    }
  }

  function goFav(lat, lng) {
    closePanel();
    if (_map) _map.setView([lat,lng], 17);
  }

  function showTrip(tripId) {
    const trip = _panelTrips.find(t => t.id === tripId);
    if (!trip || !(trip.points||[]).length) return;
    closePanel();
    _poly.setLatLngs(trip.points.map(p => [p.lat,p.lng]));
    _markers.forEach(m => _map.removeLayer(m));
    _markers = [];
    trip.points.forEach((p,i) => {
      const cls = i===0 ? ' first' : (i===trip.points.length-1 ? ' last' : '');
      const ico = L.divIcon({
        html:`<div class="gs-dot${cls}"></div>`,
        iconSize:[12,12], iconAnchor:[6,6], className:''
      });
      _markers.push(L.marker([p.lat,p.lng], {icon:ico}).addTo(_map)
        .bindPopup(`<div class="pop-t">${new Date(p.ts)
          .toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</div>`));
    });
    try {
      _map.fitBounds(
        L.latLngBounds(trip.points.map(p=>[p.lat,p.lng])),
        { padding:[40,40] }
      );
    } catch {}
  }

  // ─── IMPORT GOOGLE TAKEOUT ────────────────────────────
  async function onImport(inp) {
    const files = Array.from(inp.files);
    let count   = 0;
    for (const file of files) {
      try {
        const json = JSON.parse(await file.text());
        if (!json.features) continue;
        for (const f of json.features) {
          const coords = f.geometry?.coordinates;
          if (!coords) continue;
          const [lng,lat] = coords;
          if (!lng && !lat) continue;
          const p    = f.properties || {};
          const name = p.location?.name || p.name || 'Luogo Google Maps';
          const id   = Date.now() + Math.random();
          const fav  = {
            id, lat, lng, type:'favorite',
            name: String(name).substring(0,60),
            note: String(p.location?.address||p.address||'').substring(0,120),
            icon: '📍', ts: Date.now(), source:'google'
          };
          State.dispatch('INTENT_SAVE_RECORD', {
            recordId:id, type:'favorite', textPayload:fav
          });
          addFavMarker(fav);
          count++;
          // Piccola pausa ogni 50 import per non bloccare l'UI
          if (count % 50 === 0) await new Promise(r => setTimeout(r, 0));
        }
      } catch(e) { console.error('[map] import error:', e); }
    }
    alert(`✅ Importati ${count} luoghi`);
    inp.value = '';
  }

  // ─── IMPOSTAZIONI GPS ─────────────────────────────────
  function toggleAuto() {
    _auto = !_auto;
    const el = document.getElementById('tog-auto');
    if (el) el.className = `toggle${_auto?' on':''}`;
  }

  function setSens(v) {
    _sens = v;
    document.querySelectorAll('.seg-opt[data-v]')
      .forEach(el => el.classList.toggle('active', el.dataset.v === v));
  }

  // ─── UTILS ────────────────────────────────────────────
  function setStatus(msg, cls) {
    const el = document.getElementById('map-status');
    if (el) { el.textContent = msg; el.className = cls || ''; }
  }

  function hav(a,b,c,d) {
    const R=6371000, da=(c-a)*Math.PI/180, db=(d-b)*Math.PI/180;
    const x = Math.sin(da/2)**2 +
              Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(db/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  State.subscribe('APP_READY', () => console.log('[map] modulo pronto'));

  // Forza Leaflet a ricalcolare le dimensioni del container.
  // Necessario dopo ogni toggle display:none → display:block.
  function invalidate() {
    if (_map) {
      setTimeout(() => _map.invalidateSize(), 50);
    }
  }

  // ─── API PUBBLICA ──────────────────────────────────────
  const pub = {
    init, invalidate, toggleTrip, locateMe,
    toggleFav, openFavModal, closeFavModal, selIcon, saveFav,
    openPanel, closePanel, switchTab, goFav, showTrip,
    onImport, toggleAuto, setSens,
    getFavsForCalendar,
  };
  window.MapModule = pub;
  return pub;

})();

export default MapModule;

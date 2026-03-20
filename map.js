// ═══════════════════════════════════════════════════════
// My Life — map.js
// M1.0 + M1.1: GPS Tracker + Localizzami + Preferiti + Import
// Modulo UI "stupido" — nessuna logica di salvataggio diretto.
// Salva tramite INTENT_SAVE_RECORD.
// Legge tramite INTENT_LOAD_RECORDS.
// ═══════════════════════════════════════════════════════

import State from './state.js';
import UI    from './ui.js';

const MapModule = (() => {

  let _map      = null;
  let _poly     = null;
  let _markers  = [];
  let _curMk    = null;
  let _userMk   = null;
  let _tracking = false;
  let _trip     = null;
  let _lastPos  = null;
  let _totalDist = 0;
  let _startTime = null;
  let _timerInt  = null;
  let _watchId   = null;
  let _favMode   = false;
  let _pendFav   = null;
  let _selIcon   = '📍';

  const SENS = { low: 200, medium: 80, high: 25 };
  let _sens = 'medium';
  let _auto = false;

  // ─── INIT ─────────────────────────────────────────────
  function init() {
    if (_map) return;
    _map  = L.map('map', { zoomControl:false, attributionControl:false }).setView([45.46,9.19],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(_map);
    _poly = L.polyline([], { color:'#6c8eff', weight:4, opacity:.85 }).addTo(_map);
    _map.on('click', e => { if (_favMode) openFavModal(e.latlng); });

    // Carica i preferiti esistenti
    State.dispatch('INTENT_LOAD_RECORDS', { type:'favorite', requestId:'map_favs' });
  }

  // Ascolta i preferiti caricati e li mostra sulla mappa
  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset }) => {
    if (isAsset || !payload || payload.type !== 'favorite') return;
    if (!_map) return;
    addFavMarker(payload);
  });

  // ─── GPS TRACKING ─────────────────────────────────────
  function toggleTrip() { _tracking ? stopTrip() : startTrip(); }

  function startTrip() {
    if (!navigator.geolocation) { UI.showError('GPS non disponibile'); return; }
    _tracking  = true;
    _trip      = { id: Date.now(), points: [], startTime: Date.now() };
    _lastPos   = null; _totalDist = 0; _startTime = Date.now();
    _poly.setLatLngs([]); _markers.forEach(m=>_map.removeLayer(m)); _markers=[];
    setStatus('Ricerca GPS...','wait');
    document.getElementById('mdot').className = 'mdot rec';
    document.getElementById('trip-stats').className = 'show';
    document.getElementById('main-btn').className = 'rec';
    document.getElementById('btn-icon').textContent = '■';
    document.getElementById('btn-label').textContent = 'Ferma';
    _timerInt = setInterval(updTimer, 1000);
    _watchId  = navigator.geolocation.watchPosition(
      onPos,
      () => setStatus('GPS non disponibile','wait'),
      { enableHighAccuracy:true, maximumAge:5000, timeout:15000 }
    );
  }

  function stopTrip() {
    if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);
    clearInterval(_timerInt); _tracking = false;
    setStatus('Pronto','');
    document.getElementById('mdot').className = 'mdot';
    document.getElementById('trip-stats').className = '';
    document.getElementById('main-btn').className = '';
    document.getElementById('btn-icon').textContent = '▶';
    document.getElementById('btn-label').textContent = 'Inizia viaggio';
    document.getElementById('gps-acc').textContent = '';
    if (_trip && _trip.points.length > 0) {
      _trip.endTime = Date.now();
      State.dispatch('INTENT_SAVE_RECORD', {
        recordId:    _trip.id,
        type:        'trip',
        textPayload: _trip,
      });
    }
    _trip = null;
  }

  function onPos(pos) {
    const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords;
    document.getElementById('gps-acc').textContent = `±${Math.round(acc)}m`;
    if (_curMk) _map.removeLayer(_curMk);
    _curMk = L.circleMarker([lat,lng],{radius:8,fillColor:'#6c8eff',color:'#fff',weight:2,fillOpacity:1}).addTo(_map);
    if (_map.getZoom()<15) _map.setView([lat,lng],16); else _map.panTo([lat,lng]);
    setStatus('Registrazione','active');
    if (!_lastPos) { savePoint(lat,lng,acc); return; }
    const dist = hav(_lastPos.lat,_lastPos.lng,lat,lng);
    if (dist >= SENS[_sens]) {
      if (_auto) savePoint(lat,lng,acc);
      else {
        _lastPos = {lat,lng};
        savePoint(lat,lng,acc);
      }
    }
  }

  function savePoint(lat,lng,acc) {
    const pt = { lat, lng, acc, ts: Date.now() };
    _trip.points.push(pt);
    if (_lastPos) _totalDist += hav(_lastPos.lat,_lastPos.lng,lat,lng);
    _lastPos = {lat,lng};
    _poly.setLatLngs(_trip.points.map(p=>[p.lat,p.lng]));
    const i   = _trip.points.length-1;
    const cls = i===0?' first':(i===_trip.points.length-1?' last':'');
    const ico = L.divIcon({html:`<div class="gs-dot${cls}"></div>`,iconSize:[12,12],iconAnchor:[6,6],className:''});
    const time = new Date(pt.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    _markers.push(L.marker([lat,lng],{icon:ico}).addTo(_map)
      .bindPopup(`<div class="pop-t">${time}</div><div class="pop-s">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`));
    updStats();
  }

  function updStats() {
    document.getElementById('s-pts').textContent  = _trip ? _trip.points.length : 0;
    const d = _totalDist;
    document.getElementById('s-dist').textContent = d>=1000?`${(d/1000).toFixed(1)}km`:`${Math.round(d)}m`;
  }

  function updTimer() {
    const s = Math.floor((Date.now()-_startTime)/1000);
    document.getElementById('s-time').textContent =
      `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  // ─── LOCALIZZAMI ──────────────────────────────────────
  function locateMe() {
    if (!navigator.geolocation) { UI.showError('GPS non disponibile'); return; }
    const btn = document.getElementById('locate-btn');
    btn.textContent = '⌛';
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude:lat, longitude:lng, accuracy:acc } = pos.coords;
      if (_userMk) _map.removeLayer(_userMk);
      _userMk = L.marker([lat,lng],{icon:L.divIcon({
        html:'<div class="userdot"></div>',iconSize:[16,16],iconAnchor:[8,8],className:''
      })}).addTo(_map);
      _map.flyTo([lat,lng], Math.max(_map.getZoom(),16), {duration:1.2});
      btn.textContent = '📍';
      setStatus(`±${Math.round(acc)}m`, 'active');
      setTimeout(() => { if (!_tracking) setStatus('Pronto',''); btn.textContent='📍'; }, 3000);
    }, () => { btn.textContent='📍'; UI.showError('GPS non disponibile'); },
    {enableHighAccuracy:true, timeout:10000});
  }

  // ─── PREFERITI ────────────────────────────────────────
  function toggleFav() {
    _favMode = !_favMode;
    const btn = document.querySelector('.mibtn[data-fn="toggleFav"]');
    if (btn) { btn.style.background=_favMode?'rgba(245,200,66,.2)':''; btn.textContent=_favMode?'✕':'⭐'; }
  }

  function openFavModal(latlng) {
    _pendFav  = latlng;
    _selIcon  = '📍';
    document.querySelectorAll('.mm-icon').forEach(e => e.classList.toggle('sel', e.dataset.i==='📍'));
    document.getElementById('fav-name-in').value = '';
    document.getElementById('fav-note-in').value = '';
    document.getElementById('fav-modal').classList.add('open');
  }

  function closeFavModal() {
    document.getElementById('fav-modal').classList.remove('open');
    _favMode = false;
    const btn = document.querySelector('.mibtn[data-fn="toggleFav"]');
    if (btn) { btn.style.background=''; btn.textContent='⭐'; }
  }

  function selIcon(el) {
    document.querySelectorAll('.mm-icon').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    _selIcon = el.dataset.i;
  }

  function saveFav() {
    const name = document.getElementById('fav-name-in').value.trim();
    if (!name) { document.getElementById('fav-name-in').focus(); return; }
    const note = document.getElementById('fav-note-in').value.trim();
    const id   = Date.now();
    const fav  = { id, lat:_pendFav.lat, lng:_pendFav.lng, name, note, icon:_selIcon, ts:Date.now() };
    State.dispatch('INTENT_SAVE_RECORD', {
      recordId:    id,
      type:        'favorite',
      textPayload: fav,
    });
    addFavMarker(fav);
    closeFavModal();
  }

  function addFavMarker(fav) {
    if (!_map || !fav.lat) return;
    const ico = L.divIcon({html:`<div class="fav-mk">${fav.icon||'📍'}</div>`,iconSize:[30,30],iconAnchor:[15,15],className:''});
    L.marker([fav.lat,fav.lng],{icon:ico}).addTo(_map)
      .bindPopup(`<div class="pop-t">${UI.esc(fav.name)}</div>${fav.note?`<div class="pop-s">${UI.esc(fav.note)}</div>`:''}`);
  }

  // ─── PANEL VIAGGI/PREFERITI ───────────────────────────
  let _panelTab = 'trips';
  let _tripsCache = [];
  let _favsCache  = [];

  // Ascolta i record decifrati
  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload }) => {
    if (!payload) return;
    if (payload.type === 'trip')     _tripsCache.push(payload);
    if (payload.type === 'favorite') _favsCache.push(payload);
  });

  function openPanel() {
    _tripsCache = []; _favsCache = [];
    State.dispatch('INTENT_LOAD_RECORDS', { type:'trip',     requestId:'panel_trips' });
    State.dispatch('INTENT_LOAD_RECORDS', { type:'favorite', requestId:'panel_favs'  });
    document.getElementById('trips-panel').classList.add('open');
    setTimeout(renderPanel, 300); // attendi decifratura
  }

  function closePanel() {
    document.getElementById('trips-panel').classList.remove('open');
  }

  function switchTab(tab) {
    _panelTab = tab;
    document.getElementById('sptab-trips').className = 'sp-tab'+(tab==='trips'?' active':'');
    document.getElementById('sptab-favs').className  = 'sp-tab'+(tab==='favs'?' active':'');
    renderPanel();
  }

  function renderPanel() {
    const body = document.getElementById('trips-body');
    if (!body) return;
    if (_panelTab === 'trips') {
      const trips = [..._tripsCache].reverse();
      if (!trips.length) { body.innerHTML='<div class="no-items">Nessun viaggio</div>'; return; }
      body.innerHTML = trips.map(t => {
        const d  = new Date(t.startTime||t.id||Date.now());
        const ds = d.toLocaleDateString('it-IT',{day:'numeric',month:'short',year:'numeric'});
        const dur = t.endTime ? Math.floor((t.endTime-t.startTime)/60000) : '—';
        let dist = 0;
        const pts = t.points||[];
        for (let j=1;j<pts.length;j++) dist += hav(pts[j-1].lat,pts[j-1].lng,pts[j].lat,pts[j].lng);
        const dm = dist>=1000?`${(dist/1000).toFixed(1)}km`:`${Math.round(dist)}m`;
        return `<div class="trip-card">
          <div class="trip-card-head">
            <div class="trip-name">Viaggio ${ds}</div>
            <div class="trip-date">🔒</div>
          </div>
          <div class="trip-meta">
            <span>Punti: <b>${pts.length}</b></span>
            <span>Distanza: <b>${dm}</b></span>
            <span>Durata: <b>${dur}min</b></span>
          </div>
        </div>`;
      }).join('');
    } else {
      const favs = [..._favsCache].reverse();
      if (!favs.length) { body.innerHTML='<div class="no-items">Nessun preferito</div>'; return; }
      body.innerHTML = favs.map(f => `
        <div class="fav-card">
          <div class="fav-ico">${f.icon||'📍'}</div>
          <div class="fav-info">
            <div class="fav-name">${UI.esc(f.name)}</div>
            <div class="fav-coord">${(f.lat||0).toFixed(4)}, ${(f.lng||0).toFixed(4)}</div>
            ${f.note?`<div class="fav-note">${UI.esc(f.note)}</div>`:''}
          </div>
          <div class="fav-acts">
            <div class="fav-act" onclick="MapModule.goFav(${f.lat},${f.lng})">🎯</div>
          </div>
        </div>`).join('');
    }
  }

  function goFav(lat,lng) { closePanel(); _map.setView([lat,lng],17); }

  // ─── IMPORT GOOGLE TAKEOUT ────────────────────────────
  async function onImport(inp) {
    const files = Array.from(inp.files);
    let count   = 0;
    for (const file of files) {
      try {
        const json = JSON.parse(await file.text());
        if (!json.features) continue;
        for (const f of json.features) {
          const [lng,lat] = f.geometry?.coordinates||[0,0];
          if (!lng && !lat) continue;
          const p    = f.properties||{};
          const name = p.location?.name||p.name||'Luogo Google Maps';
          const id   = Date.now()+Math.random();
          const fav  = {
            id, lat, lng,
            name:   String(name).substring(0,60),
            note:   String(p.location?.address||p.address||'').substring(0,120),
            icon:   '📍', ts: Date.now(), source: 'google'
          };
          State.dispatch('INTENT_SAVE_RECORD', {
            recordId: id, type: 'favorite', textPayload: fav
          });
          addFavMarker(fav);
          count++;
        }
      } catch(e) { console.error('import error:', e); }
    }
    alert(`Importati ${count} luoghi`);
    inp.value = '';
  }

  // ─── IMPOSTAZIONI GPS ─────────────────────────────────
  function toggleAuto() {
    _auto = !_auto;
    const el = document.getElementById('tog-auto');
    if (el) el.className = 'toggle'+(_auto?' on':'');
  }

  function setSens(v) {
    _sens = v;
    document.querySelectorAll('.seg-opt').forEach(el => el.classList.toggle('active', el.dataset.v===v));
  }

  // ─── UTILS ────────────────────────────────────────────
  function setStatus(msg,cls) {
    const el = document.getElementById('map-status');
    if (el) { el.textContent=msg; el.className=cls||''; }
  }

  function hav(a,b,c,d) {
    const R=6371000,da=(c-a)*Math.PI/180,db=(d-b)*Math.PI/180;
    const x=Math.sin(da/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(db/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }

  // Attendi che la mappa sia pronta
  State.subscribe('APP_READY', () => {
    console.log('[map] pronto');
  });

  // Esponi per HTML
  const pub = {
    init, toggleTrip, locateMe, toggleFav, openFavModal, closeFavModal,
    selIcon, saveFav, openPanel, closePanel, switchTab, goFav, onImport,
    toggleAuto, setSens
  };
  window.MapModule = pub;
  return pub;

})();

export default MapModule;

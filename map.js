// ═══════════════════════════════════════════════
// My Life — map.js  v3.0
// M1.0 + M1.1: GPS, localizzami, preferiti, import
// Dipende da: crypto.js, db.js
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// MAP
// ══════════════════════════════════════════════════════
function openMap() {
  showScreen('map-screen');
  if (!S.map) initMap();
}

function initMap() {
  S.map  = L.map('map',{zoomControl:false,attributionControl:false}).setView([45.46,9.19],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(S.map);
  S.poly = L.polyline([],{color:'#6c8eff',weight:4,opacity:.85}).addTo(S.map);
  S.map.on('click', e => { if (S.favMode) openFavModal(e.latlng); });
  renderFavMarkers();
}

function locateMe() {
  if (!navigator.geolocation) { showErr('GPS non disponibile'); return; }
  const btn = document.getElementById('locate-btn');
  btn.textContent = '⌛';
  navigator.geolocation.getCurrentPosition(pos => {
    const {latitude:lat, longitude:lng, accuracy:acc} = pos.coords;
    if (S.userMk) S.map.removeLayer(S.userMk);
    S.userMk = L.marker([lat,lng],{icon:L.divIcon({
      html:'<div class="userdot"></div>',iconSize:[16,16],iconAnchor:[8,8],className:''
    })}).addTo(S.map).bindPopup(`<div class="pop-t">📍 Sei qui</div><div class="pop-s">±${Math.round(acc)}m</div>`);
    S.map.flyTo([lat,lng], Math.max(S.map.getZoom(),16), {duration:1.2});
    btn.textContent = '📍';
    setMapStatus(`±${Math.round(acc)}m`, 'active');
    setTimeout(() => { if (!S.tracking) setMapStatus('Pronto',''); btn.textContent='📍'; }, 3000);
  }, () => { btn.textContent='📍'; showErr('GPS non disponibile'); }, {enableHighAccuracy:true,timeout:10000});
}

function toggleTrip() { S.tracking ? stopTrip() : startTrip(); }

function startTrip() {
  if (!navigator.geolocation) { showErr('GPS non disponibile'); return; }
  S.tracking = true;
  S.trip     = {id:Date.now(), points:[], startTime:Date.now()};
  S.lastPos  = null; S.totalDist = 0; S.startTime = Date.now();
  S.poly.setLatLngs([]); S.markers.forEach(m=>S.map.removeLayer(m)); S.markers=[];
  setMapStatus('Ricerca GPS...','wait');
  document.getElementById('mdot').className = 'mdot rec';
  document.getElementById('trip-stats').className = 'show';
  document.getElementById('main-btn').className = 'rec';
  document.getElementById('btn-icon').textContent = '■';
  document.getElementById('btn-label').textContent = 'Ferma';
  S.timerInt = setInterval(updTimer,1000);
  S.watchId  = navigator.geolocation.watchPosition(onPos, ()=>setMapStatus('GPS non disponibile','wait'),
    {enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}

async function stopTrip() {
  if (S.watchId !== null) navigator.geolocation.clearWatch(S.watchId);
  clearInterval(S.timerInt); S.tracking = false;
  setMapStatus('Pronto','');
  document.getElementById('mdot').className = 'mdot';
  document.getElementById('w-map-badge').textContent = '● LIVE';
  document.getElementById('trip-stats').className = '';
  document.getElementById('main-btn').className = '';
  document.getElementById('btn-icon').textContent = '▶';
  document.getElementById('btn-label').textContent = 'Inizia viaggio';
  document.getElementById('gps-acc').textContent = '';
  if (S.trip && S.trip.points.length > 0) {
    S.trip.endTime = Date.now();
    try { await dbPut('trips', S.trip); } catch(e) { console.error(e); }
  }
  S.trip = null;
}

function onPos(pos) {
  const {latitude:lat, longitude:lng, accuracy:acc} = pos.coords;
  document.getElementById('gps-acc').textContent = `±${Math.round(acc)}m`;
  if (S.curMk) S.map.removeLayer(S.curMk);
  S.curMk = L.circleMarker([lat,lng],{radius:8,fillColor:'#6c8eff',color:'#fff',weight:2,fillOpacity:1}).addTo(S.map);
  if (S.map.getZoom()<15) S.map.setView([lat,lng],16); else S.map.panTo([lat,lng]);
  setMapStatus('Registrazione','active');
  if (!S.lastPos) { savePoint(lat,lng,acc); return; }
  const dist = hav(S.lastPos.lat,S.lastPos.lng,lat,lng);
  if (dist >= 50) { S.lastPos={lat,lng}; savePoint(lat,lng,acc); }
}

function savePoint(lat,lng,acc) {
  const pt = {lat,lng,acc,ts:Date.now()};
  S.trip.points.push(pt);
  if (S.lastPos) S.totalDist += hav(S.lastPos.lat,S.lastPos.lng,lat,lng);
  S.lastPos = {lat,lng};
  S.poly.setLatLngs(S.trip.points.map(p=>[p.lat,p.lng]));
  const i = S.trip.points.length-1;
  const cls = i===0?' first':(i===S.trip.points.length-1?' last':'');
  const icon = L.divIcon({html:`<div class="gs-dot${cls}"></div>`,iconSize:[12,12],iconAnchor:[6,6],className:''});
  S.markers.push(L.marker([lat,lng],{icon}).addTo(S.map)
    .bindPopup(`<div class="pop-t">${new Date(pt.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</div><div class="pop-s">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`));
  updStats();
}

function updStats() {
  document.getElementById('s-pts').textContent = S.trip ? S.trip.points.length : 0;
  const d = S.totalDist;
  document.getElementById('s-dist').textContent = d>=1000?`${(d/1000).toFixed(1)}km`:`${Math.round(d)}m`;
}
function updTimer() {
  const s = Math.floor((Date.now()-S.startTime)/1000);
  document.getElementById('s-time').textContent =
    `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function setMapStatus(msg,cls) {
  const el = document.getElementById('map-status');
  el.textContent=msg; el.className=cls||'';
}

// MAP exposed as window.MAP for navigation helpers
window.MAP = {
  selIcon(el) {
    document.querySelectorAll('.mm-icon').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    S.selIcon = el.dataset.i;
  },
  closeFavModal() {
    document.getElementById('fav-modal').classList.remove('open');
    S.favMode = false;
    const btn = document.querySelector('.mibtn:nth-child(2)');
    if (btn) { btn.style.background=''; btn.textContent='⭐'; }
  },
  async saveFav() {
    const name = document.getElementById('fav-name-in').value.trim();
    if (!name) { document.getElementById('fav-name-in').focus(); return; }
    const note = document.getElementById('fav-note-in').value.trim();
    const icon = S.selIcon || '📍';
    const fav  = { id:Date.now(), lat:S.pendFav.lat, lng:S.pendFav.lng, name, note, icon, ts:Date.now() };
    await dbPut('favorites', fav);
    addFavMarker(fav);
    this.closeFavModal();
    document.getElementById('fav-name-in').value = '';
    document.getElementById('fav-note-in').value = '';
  },
  openPanel() {
    this._panelTab = 'trips';
    document.getElementById('trips-panel').classList.add('open');
    this.renderPanel();
  },
  closePanel() {
    document.getElementById('trips-panel').classList.remove('open');
  },
  _panelTab: 'trips',
  switchTab(tab) {
    this._panelTab = tab;
    document.getElementById('sptab-trips').className = 'sp-tab' + (tab==='trips'?' active':'');
    document.getElementById('sptab-favs').className  = 'sp-tab' + (tab==='favs'?' active':'');
    this.renderPanel();
  },
  async renderPanel() {
    const body = document.getElementById('trips-body');
    if (!body) return;
    if (this._panelTab === 'trips') {
      const trips = (await dbAll('trips')).reverse();
      if (!trips.length) { body.innerHTML='<div class="no-items">Nessun viaggio registrato</div>'; return; }
      body.innerHTML = trips.map((t,i) => {
        const d    = new Date(t.startTime||t.id);
        const ds   = d.toLocaleDateString('it-IT',{day:'numeric',month:'short',year:'numeric'});
        const dur  = t.endTime ? Math.floor((t.endTime-t.startTime)/60000) : '—';
        let dist   = 0;
        const pts  = t.points||[];
        for (let j=1; j<pts.length; j++) dist += hav(pts[j-1].lat,pts[j-1].lng,pts[j].lat,pts[j].lng);
        const dm   = dist>=1000 ? `${(dist/1000).toFixed(1)}km` : `${Math.round(dist)}m`;
        return `<div class="trip-card" onclick="MAP.showTrip(${trips.length-1-i})">
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
      const favs = (await dbAll('favorites')).reverse();
      if (!favs.length) { body.innerHTML='<div class="no-items">Nessun preferito</div>'; return; }
      body.innerHTML = favs.map(f => `
        <div class="fav-card">
          <div class="fav-ico">${f.icon||'📍'}</div>
          <div class="fav-info">
            <div class="fav-name">${esc(f.name)}</div>
            <div class="fav-coord">${(f.lat||0).toFixed(4)}, ${(f.lng||0).toFixed(4)}</div>
            ${f.note?`<div class="fav-note">${esc(f.note)}</div>`:''}
          </div>
          <div class="fav-acts">
            <div class="fav-act" onclick="MAP.goFav(${f.lat},${f.lng})">🎯</div>
            <div class="fav-act" onclick="MAP.delFav(${f.id})" style="color:var(--red)">🗑</div>
          </div>
        </div>`).join('');
    }
  },
  async showTrip(idx) {
    const trips = await dbAll('trips');
    const trip  = trips[idx];
    if (!trip || !(trip.points||[]).length) return;
    this.closePanel();
    S.poly.setLatLngs(trip.points.map(p=>[p.lat,p.lng]));
    S.markers.forEach(m=>S.map.removeLayer(m)); S.markers=[];
    trip.points.forEach((p,i) => {
      const cls = i===0?' first':(i===trip.points.length-1?' last':'');
      const icon = L.divIcon({html:`<div class="gs-dot${cls}"></div>`,iconSize:[12,12],iconAnchor:[6,6],className:''});
      const time = new Date(p.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
      S.markers.push(L.marker([p.lat,p.lng],{icon}).addTo(S.map)
        .bindPopup(`<div class="pop-t">${time}</div>`));
    });
    S.map.fitBounds(L.latLngBounds(trip.points.map(p=>[p.lat,p.lng])),{padding:[40,40]});
  },
  goFav(lat,lng) { this.closePanel(); S.map.setView([lat,lng],17); },
  async delFav(id) { await dbDel('favorites',id); this.renderPanel(); },
  toggleAuto() {
    S.autoMode = !S.autoMode;
    document.getElementById('tog-auto').className = 'toggle'+(S.autoMode?' on':'');
    localStorage.setItem('ml_autoMode', S.autoMode);
  },
  setSens(v) {
    S.sensitivity = v;
    document.querySelectorAll('.seg-opt').forEach(el => el.classList.toggle('active', el.dataset.v===v));
    localStorage.setItem('ml_sensitivity', v);
  }
};

function toggleFav() {
  S.favMode = !S.favMode;
  const btn = document.querySelector('.mibtn:nth-child(2)');
  if (btn) { btn.style.background = S.favMode?'rgba(245,200,66,.2)':''; btn.textContent = S.favMode?'✕':'⭐'; }
}

function openFavModal(latlng) {
  S.pendFav = latlng;
  S.selIcon = '📍';
  document.querySelectorAll('.mm-icon').forEach(e => e.classList.toggle('sel', e.dataset.i==='📍'));
  document.getElementById('fav-name-in').value = '';
  document.getElementById('fav-note-in').value = '';
  document.getElementById('fav-modal').classList.add('open');
}
async function renderFavMarkers() {
  try {
    const favs = await dbAll('favorites');
    favs.forEach(f => {
      if (!f.lat) return;
      const icon = L.divIcon({html:`<div class="fav-mk">${f.icon||'📍'}</div>`,iconSize:[30,30],iconAnchor:[15,15],className:''});
      L.marker([f.lat,f.lng],{icon}).addTo(S.map)
        .bindPopup(`<div class="pop-t">${f.name||'Preferito'}</div>`);
    });
  } catch {}
}

// ══════════════════════════════════════════════════════
// GOOGLE IMPORT
// ══════════════════════════════════════════════════════
async function onImport(inp) {
  const files = Array.from(inp.files);
  let count = 0;
  for (const file of files) {
    try {
      const json = JSON.parse(await file.text());
      if (!json.features) continue;
      for (const f of json.features) {
        const [lng,lat] = f.geometry?.coordinates || [0,0];
        if (!lng && !lat) continue;
        const p = f.properties || {};
        const name = p.location?.name || p.name || 'Luogo Google Maps';
        await dbPut('favorites', {
          id: Date.now()+Math.random(),
          lat, lng,
          name: String(name).substring(0,60),
          note: String(p.location?.address || p.address || '').substring(0,120),
          icon: '📍', ts: Date.now(),
          source: 'google'
        });
        count++;
      }
    } catch(e) { console.error('import error:', e); }
  }
  if (S.map) renderFavMarkers();
  alert(`Importati ${count} luoghi`);
  inp.value = '';
}


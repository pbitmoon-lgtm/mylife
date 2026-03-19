// ═══════════════════════════════════════════════
// My Life — map.js
// M1.0 + M1.1 · GPS Tracker + Localizzami +
//               Preferiti + Import Google Takeout
// Dipendenze: db.js, crypto.js
// Usa: window.APP.state, Leaflet
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════════
function initMap(){
  S.map=L.map('map',{zoomControl:false,attributionControl:false}).setView([45.46,9.19],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(S.map);
  S.poly=L.polyline([],{color:'#6c8eff',weight:4,opacity:.85}).addTo(S.map);
  S.map.on('click',e=>{if(S.favMode)openFavModal(e.latlng);});
  renderFavMarkers();
}

function locateMe(){
  if(!navigator.geolocation){alert('GPS non disponibile');return;}
  const btn=document.getElementById('locate-btn');
  btn.className='locating';btn.textContent='⌛';
  setMapStatus('Localizzazione...','waiting');
  navigator.geolocation.getCurrentPosition(pos=>{
    const{latitude:lat,longitude:lng,accuracy}=pos.coords;
    if(S.userMarker)S.map.removeLayer(S.userMarker);
    S.userMarker=L.marker([lat,lng],{icon:L.divIcon({html:'<div class="user-dot"></div>',iconSize:[16,16],iconAnchor:[8,8],className:''})})
      .addTo(S.map).bindPopup(`<div class="pop-title">📍 Sei qui</div><div class="pop-sub">±${Math.round(accuracy)}m</div>`);
    S.map.flyTo([lat,lng],Math.max(S.map.getZoom(),16),{duration:1.2});
    btn.className='located';btn.textContent='📍';
    setMapStatus(`±${Math.round(accuracy)}m`,'active');
    setTimeout(()=>{if(!S.tracking){setMapStatus('Pronto','');btn.className='';btn.textContent='📍';}},3000);
  },()=>{btn.className='';btn.textContent='📍';setMapStatus('GPS non disponibile','waiting');setTimeout(()=>setMapStatus('Pronto',''),3000);},
  {enableHighAccuracy:true,timeout:10000,maximumAge:5000});
}

function toggleTracking(){if(S.favMode)cancelFavMode();S.tracking?stopTracking():startTracking();}
function startTracking(){
  if(!navigator.geolocation){alert('GPS non disponibile');return;}
  S.tracking=true;S.trip={id:Date.now(),points:[],startTime:Date.now()};
  S.lastPos=null;S.totalDist=0;S.startTime=Date.now();
  S.poly.setLatLngs([]);S.markers.forEach(m=>S.map.removeLayer(m));S.markers=[];
  setMapStatus('Ricerca GPS...','waiting');
  document.getElementById('logo-dot').className='map-logo-dot rec';
  document.getElementById('trip-stats').className='show';
  document.getElementById('main-btn').className='rec';
  document.getElementById('btn-icon').textContent='■';
  document.getElementById('btn-label').textContent='Ferma';
  document.getElementById('w-map-badge').textContent='● REC';
  S.timerInt=setInterval(updateTimer,1000);
  S.watchId=navigator.geolocation.watchPosition(onPos,onGpsErr,{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}
async function stopTracking(){
  if(S.watchId!==null)navigator.geolocation.clearWatch(S.watchId);
  clearInterval(S.timerInt);S.tracking=false;
  dismissBanner();setMapStatus('Pronto','');
  document.getElementById('logo-dot').className='map-logo-dot';
  document.getElementById('trip-stats').className='';
  document.getElementById('main-btn').className='';
  document.getElementById('btn-icon').textContent='▶';
  document.getElementById('btn-label').textContent='Inizia viaggio';
  document.getElementById('gps-acc').textContent='';
  document.getElementById('w-map-badge').textContent='● LIVE';
  if(S.trip&&S.trip.points.length){S.trip.endTime=Date.now();await dbPut('trips',S.trip);}
  S.trip=null;
}
function onPos(pos){
  const{latitude:lat,longitude:lng,accuracy}=pos.coords;
  document.getElementById('gps-acc').textContent=`±${Math.round(accuracy)}m`;
  if(S.curMarker)S.map.removeLayer(S.curMarker);
  S.curMarker=L.circleMarker([lat,lng],{radius:8,fillColor:'#6c8eff',color:'#fff',weight:2,fillOpacity:1}).addTo(S.map);
  if(S.map.getZoom()<15)S.map.setView([lat,lng],16);else S.map.panTo([lat,lng]);
  setMapStatus('Registrazione','active');
  if(!S.lastPos){savePt(lat,lng,accuracy);return;}
  const dist=hav(S.lastPos.lat,S.lastPos.lng,lat,lng);
  if(dist>=SENS[S.sensitivity].d){S.pendPos={lat,lng,accuracy};if(S.autoMode)savePt(lat,lng,accuracy);else showBanner(dist);}
}
function onGpsErr(){setMapStatus('GPS non disponibile','waiting');}
function savePt(lat,lng,acc,comment='',photo=null){
  const pt={lat,lng,acc,ts:Date.now(),comment,photo};
  S.trip.points.push(pt);
  if(S.lastPos)S.totalDist+=hav(S.lastPos.lat,S.lastPos.lng,lat,lng);
  S.lastPos={lat,lng};
  S.poly.setLatLngs(S.trip.points.map(p=>[p.lat,p.lng]));
  const i=S.trip.points.length-1;
  const cls=i===0?' first':(photo?' has-photo':'');
  const icon=L.divIcon({html:`<div class="gs-marker${cls}"></div>`,iconSize:[12,12],iconAnchor:[6,6],className:''});
  const time=new Date(pt.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  let pop=`<div class="pop-title">${time}</div>`;
  if(comment)pop+=`<div class="pop-comment">"${comment}"</div>`;
  if(photo)pop+=`<img class="pop-img" src="${photo}">`;
  pop+=`<div class="pop-sub">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>`;
  S.markers.push(L.marker([lat,lng],{icon}).addTo(S.map).bindPopup(pop));
  updStats();dismissBanner();
}
function showBanner(dist){
  document.getElementById('banner-title').textContent='Movimento rilevato';
  document.getElementById('banner-sub').textContent=`+${Math.round(dist)} m — Vuoi salvare?`;
  document.getElementById('point-comment').value='';removePhoto();
  document.getElementById('confirm-banner').className='show';
  setTimeout(()=>{if(document.getElementById('confirm-banner').className==='show')dismissBanner();},20000);
}
function confirmPoint(){
  if(S.pendPos){savePt(S.pendPos.lat,S.pendPos.lng,S.pendPos.acc,document.getElementById('point-comment').value.trim(),S.pendPhoto);S.pendPos=null;S.pendPhoto=null;}
}
function dismissBanner(){document.getElementById('confirm-banner').className='';S.pendPos=null;}
function triggerPhoto(s){document.getElementById(s==='camera'?'input-camera':'input-gallery').click();}
function onMapPhoto(inp){
  const f=inp.files[0];if(!f)return;
  resize(f,800,img=>{S.pendPhoto=img;document.getElementById('preview-img').src=img;document.getElementById('photo-preview').className='photo-preview show';});
  inp.value='';
}
function removePhoto(){S.pendPhoto=null;document.getElementById('photo-preview').className='photo-preview';document.getElementById('preview-img').src='';}
function updStats(){
  document.getElementById('stat-points').textContent=S.trip?S.trip.points.length:0;
  const d=S.totalDist;document.getElementById('stat-dist').textContent=d>=1000?`${(d/1000).toFixed(1)} km`:`${Math.round(d)} m`;
}
function updateTimer(){
  const s=Math.floor((Date.now()-S.startTime)/1000);
  document.getElementById('stat-time').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function setMapStatus(msg,cls){const el=document.getElementById('map-status');el.textContent=msg;el.className=cls||'';}

// FAVORITES (map)
function toggleFavMode(){
  if(S.tracking)return;S.favMode=!S.favMode;
  document.getElementById('fav-toggle-btn').className='map-btn'+(S.favMode?' active':'');
  document.getElementById('fav-mode-bar').style.display=S.favMode?'flex':'none';
}
function cancelFavMode(){S.favMode=false;document.getElementById('fav-toggle-btn').className='map-btn';document.getElementById('fav-mode-bar').style.display='none';}
function openFavModal(ll){S.pendFav=ll;document.getElementById('fav-name').value='';document.getElementById('fav-note').value='';S.selIcon='📍';document.querySelectorAll('.icon-opt').forEach(e=>e.classList.toggle('sel',e.dataset.icon==='📍'));document.getElementById('fav-modal').className='modal-backdrop open';}
function closeFavModal(){document.getElementById('fav-modal').className='modal-backdrop';cancelFavMode();}
function selectIcon(el){document.querySelectorAll('.icon-opt').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');S.selIcon=el.dataset.icon;}
async function saveFavorite(){
  const name=document.getElementById('fav-name').value.trim();if(!name)return;
  const fav={id:Date.now(),lat:S.pendFav.lat,lng:S.pendFav.lng,name,note:document.getElementById('fav-note').value.trim(),icon:S.selIcon,ts:Date.now()};
  await dbPut('favorites',fav);closeFavModal();addFavMk(fav);
}
function addFavMk(fav){
  const icon=L.divIcon({html:`<div class="fav-mw">${fav.icon}</div>`,iconSize:[30,30],iconAnchor:[15,15],className:''});
  L.marker([fav.lat,fav.lng],{icon}).addTo(S.map)
    .bindPopup(`<div class="pop-title">${fav.name}</div>${fav.note?`<div class="pop-comment">"${fav.note}"</div>`:''}<div class="pop-sub">${(fav.lat).toFixed(4)}, ${(fav.lng).toFixed(4)}</div>`);
}
async function renderFavMarkers(){const favs=await dbAll('favorites');favs.forEach(addFavMk);}

// TRIPS PANEL
let ptab='trips';
async function renderTrips(){
  const body=document.getElementById('trips-body');
  if(ptab==='trips'){
    const trips=(await dbAll('trips')).reverse();
    if(!trips.length){body.innerHTML=`<div class="no-items">Nessun viaggio</div>`;return;}
    body.innerHTML=trips.map((t,i)=>{
      const d=new Date(t.startTime||t.id);
      const ds=d.toLocaleDateString('it-IT',{day:'numeric',month:'short',year:'numeric'});
      const dur=t.endTime?Math.floor((t.endTime-t.startTime)/60000):'—';
      const dist=tripDist(t);const dm=dist>=1000?`${(dist/1000).toFixed(1)} km`:`${Math.round(dist)} m`;
      return`<div class="trip-card" onclick="showTrip(${trips.length-1-i})">
        <div class="trip-card-header"><div class="trip-name">Viaggio ${ds}</div><div class="trip-date">🔒</div></div>
        <div class="trip-meta">
          <div class="trip-meta-item">Punti: <span>${(t.points||[]).length}</span></div>
          <div class="trip-meta-item">Dist: <span>${dm}</span></div>
          <div class="trip-meta-item">Durata: <span>${dur}min</span></div>
        </div></div>`;
    }).join('');
  } else {
    const favs=(await dbAll('favorites')).reverse();
    if(!favs.length){body.innerHTML=`<div class="no-items">Nessun preferito</div>`;return;}
    body.innerHTML=favs.map(f=>`
      <div class="fav-card">
        <div class="fav-icon-big">${f.icon||'📍'}</div>
        <div class="fav-info">
          <div class="fav-name">${esc(f.name)}</div>
          <div class="fav-coords">${(f.lat||0).toFixed(4)}, ${(f.lng||0).toFixed(4)}</div>
          ${f.note?`<div class="fav-note-txt">${esc(f.note)}</div>`:''}
        </div>
        <div class="fav-actions">
          <button class="fav-btn" onclick="goFav(${f.lat},${f.lng})">🎯</button>
          <button class="fav-btn" onclick="delFav(${f.id})" style="color:var(--red)">🗑</button>
        </div>
      </div>`).join('');
  }
}
function switchPTab(tab){ptab=tab;document.getElementById('ptab-trips').className='tab'+(tab==='trips'?' active':'');document.getElementById('ptab-favs').className='tab'+(tab==='favs'?' active':'');renderTrips();}
async function showTrip(idx){
  const trips=await dbAll('trips');const trip=trips[idx];if(!trip)return;
  closeSubPanel('trips-panel');
  S.poly.setLatLngs(trip.points.map(p=>[p.lat,p.lng]));
  S.markers.forEach(m=>S.map.removeLayer(m));S.markers=[];
  trip.points.forEach((p,i)=>{
    const cls=i===0?' first':(i===trip.points.length-1?' last':(p.photo?' has-photo':''));
    const icon=L.divIcon({html:`<div class="gs-marker${cls}"></div>`,iconSize:[12,12],iconAnchor:[6,6],className:''});
    const time=new Date(p.ts).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
    let pop=`<div class="pop-title">${time}</div>`;
    if(p.comment)pop+=`<div class="pop-comment">"${p.comment}"</div>`;
    if(p.photo)pop+=`<img class="pop-img" src="${p.photo}">`;
    S.markers.push(L.marker([p.lat,p.lng],{icon}).addTo(S.map).bindPopup(pop));
  });
  if(trip.points.length)S.map.fitBounds(L.latLngBounds(trip.points.map(p=>[p.lat,p.lng])),{padding:[40,40]});
}
function goFav(lat,lng){closeSubPanel('trips-panel');S.map.setView([lat,lng],17);}
async function delFav(id){await dbDel('favorites',id);renderTrips();}
function tripDist(t){let d=0;const p=t.points||[];for(let i=1;i<p.length;i++)d+=hav(p[i-1].lat,p[i-1].lng,p[i].lat,p[i].lng);return d;}

// GOOGLE IMPORT
function detectType(json){
  const f=json.features?.[0];if(!f)return null;
  if(f.properties?.date&&f.properties?.google_maps_url)return'saved';
  if(f.properties?.name&&!f.properties?.date)return'labeled';
  return null;
}
function parseCoords(f){
  const[lng,lat]=f.geometry.coordinates;
  if(lng===0&&lat===0){const m=(f.properties.google_maps_url||'').match(/q=([-\d.]+),([-\d.]+)/);if(m)return{lat:+m[1],lng:+m[2],est:true}; return null;}
  return{lat,lng,est:false};
}
function guessIcon(name,addr){
  const s=(name+' '+addr).toLowerCase();
  if(/hotel|albergo|resort/.test(s))return'🏨';if(/ristorante|restaurant|osteria/.test(s))return'🍽';
  if(/pizz/.test(s))return'🍕';if(/caffè|coffee|bar/.test(s))return'☕';
  if(/chiesa|basilica|cattedrale/.test(s))return'⛪';if(/spiaggia|beach/.test(s))return'🏖';
  if(/museum|museo/.test(s))return'🏛';if(/airport|aeroporto/.test(s))return'✈️';
  if(/ospedale|hospital/.test(s))return'🏥';return'📍';
}
function guessIconLabel(name){
  const s=(name||'').toLowerCase();
  if(/casa|home/.test(s))return'🏠';if(/lavoro|ufficio|work/.test(s))return'🏢';return'📍';
}
function parseSaved(json){
  const ok=[],skip=[];
  for(const f of json.features){
    const c=parseCoords(f);if(!c){skip.push(1);continue;}
    const p=f.properties;const name=p.location?.name||'Luogo Google Maps';const addr=p.location?.address||'';
    ok.push({id:Date.now()+Math.random(),lat:c.lat,lng:c.lng,name,note:addr+(c.est?' · ⚠️ Posizione approssimativa':''),address:addr,icon:guessIcon(name,addr),ts:new Date(p.date).getTime()||Date.now(),source:'saved',googleUrl:p.google_maps_url});
  }
  return{ok,skip};
}
function parseLabeled(json){
  const ok=[],skip=[];
  for(const f of json.features){
    const c=parseCoords(f);if(!c){skip.push(1);continue;}
    const p=f.properties;
    ok.push({id:Date.now()+Math.random(),lat:c.lat,lng:c.lng,name:p.name||'Luogo etichettato',note:p.address||'',address:p.address||'',icon:guessIconLabel(p.name),ts:Date.now(),source:'labeled'});
  }
  return{ok,skip};
}
function onDragOver(e){e.preventDefault();document.getElementById('drop-zone').classList.add('drag-over');}
function onDragLeave(){document.getElementById('drop-zone').classList.remove('drag-over');}
function onDrop(e){e.preventDefault();document.getElementById('drop-zone').classList.remove('drag-over');processImport(Array.from(e.dataTransfer.files));}
function onImportFile(inp){processImport(Array.from(inp.files));inp.value='';}
async function processImport(files){
  S.pendImport=[];const res=document.getElementById('import-results');
  res.innerHTML='<div style="font-size:12px;color:var(--text2);padding:8px">Analisi...</div>';
  let html='',tot=0;
  for(const file of files.filter(f=>f.name.endsWith('.json'))){
    try{
      const json=JSON.parse(await file.text());const type=detectType(json);
      if(!type){html+=`<div class="import-result-card">⚠️ ${file.name} — formato non riconosciuto</div>`;continue;}
      const parsed=type==='saved'?parseSaved(json):parseLabeled(json);
      S.pendImport.push(...parsed.ok);tot+=parsed.ok.length;
      const lbl=type==='saved'?'📍 Luoghi salvati':'🏷 Luoghi etichettati';
      html+=`<div class="import-result-card">
        <div style="font-weight:700;margin-bottom:6px">${lbl} <span class="badge-ok">+${parsed.ok.length}</span>${parsed.skip.length?` <span class="badge-skip">${parsed.skip.length} saltati</span>`:''}</div>
        ${parsed.ok.slice(0,4).map(p=>`<div style="font-size:12px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);display:flex;gap:8px"><span>${p.icon}</span><div><div style="font-weight:600">${esc(p.name)}</div>${p.address?`<div style="font-size:10px;color:var(--text2)">${esc(p.address.substring(0,50))}</div>`:''}</div></div>`).join('')}
        ${parsed.ok.length>4?`<div style="font-size:11px;color:var(--text2);padding-top:4px">...e altri ${parsed.ok.length-4}</div>`:''}
      </div>`;
    }catch(e){html+=`<div class="import-result-card" style="color:var(--red)">❌ ${file.name}</div>`;}
  }
  res.innerHTML=html;
  if(tot>0){document.getElementById('import-confirm-wrap').style.display='block';document.getElementById('import-confirm-btn').textContent=`Importa ${tot} luoghi`;}
}
async function confirmImport(){
  if(!S.pendImport?.length)return;
  const btn=document.getElementById('import-confirm-btn');btn.textContent='...';btn.disabled=true;
  let c=0;for(const fav of S.pendImport){await dbPut('favorites',{...fav,id:Date.now()+c});addFavMk(fav);c++;}
  const lls=S.pendImport.map(f=>[f.lat,f.lng]);
  try{S.map.fitBounds(L.latLngBounds(lls),{padding:[40,40],maxZoom:8});}catch{}
  document.getElementById('import-results').innerHTML=
    `<div style="background:rgba(52,214,158,.1);border:1px solid rgba(52,214,158,.3);border-radius:14px;padding:20px;text-align:center">
      <div style="font-size:28px;margin-bottom:8px">✅</div>
      <div style="font-size:15px;font-weight:700;color:var(--green)">Importati ${c} luoghi</div>
    </div>`;
  document.getElementById('import-confirm-wrap').style.display='none';S.pendImport=null;
  updateHomeWidgets();
}
function cancelImport(){S.pendImport=null;document.getElementById('import-results').innerHTML='';document.getElementById('import-confirm-wrap').style.display='none';}


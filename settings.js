// ═══════════════════════════════════════════════
// My Life — settings.js
// Impostazioni · Lingua · Export · Clear data
// Dipendenze: db.js
// Usa: window.APP.state
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
function loadSettings(){
  const s=localStorage.getItem('ml_settings');
  if(s){const p=JSON.parse(s);S.lang=p.lang||'it';S.autoMode=p.autoMode||false;S.sensitivity=p.sensitivity||'medium';}
  document.getElementById('toggle-auto').className='toggle'+(S.autoMode?' on':'');
  document.querySelectorAll('#seg-sens .seg-opt').forEach(el=>el.classList.toggle('active',el.dataset.val===S.sensitivity));
  document.getElementById('seg-it')?.classList.toggle('active',S.lang==='it');
  document.getElementById('seg-en')?.classList.toggle('active',S.lang==='en');
}
function saveSettings(){localStorage.setItem('ml_settings',JSON.stringify({lang:S.lang,autoMode:S.autoMode,sensitivity:S.sensitivity}));}
function toggleAuto(){S.autoMode=!S.autoMode;document.getElementById('toggle-auto').className='toggle'+(S.autoMode?' on':'');saveSettings();}
function setSens(v){S.sensitivity=v;document.querySelectorAll('#seg-sens .seg-opt').forEach(el=>el.classList.toggle('active',el.dataset.val===v));saveSettings();}
function setLang(l){S.lang=l;document.getElementById('seg-it').classList.toggle('active',l==='it');document.getElementById('seg-en').classList.toggle('active',l==='en');saveSettings();}
async function exportData(){
  const trips=await dbAll('trips');const favs=await dbAll('favorites');const notes=await dbAll('notes');
  const b=new Blob([JSON.stringify({trips,favorites:favs,notes,exported:Date.now()},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`mylife_${Date.now()}.json`;a.click();
}
async function clearData(){
  if(!confirm('Cancellare tutti i dati?'))return;
  for(const s of['trips','favorites','notes']){const r=await dbAll(s);for(const x of r)await dbDel(s,x.id);}
  S.notes=[];renderNotes();updateHomeWidgets();
}


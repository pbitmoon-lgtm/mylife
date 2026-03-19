// ═══════════════════════════════════════════════
// My Life — notes.js
// M1.2 · Note cifrate stile Google Keep
//         Editor · Tag · Checklist · Immagini annotate
// Dipendenze: db.js, crypto.js
// Usa: window.APP.state
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// NOTES
// ═══════════════════════════════════════════════
async function loadNotes(){S.notes=await dbAll('notes');}

function renderNotes(){
  const q=(document.getElementById('notes-search').value||'').toLowerCase();
  let notes=[...S.notes].sort((a,b)=>{
    if(a.pinned&&!b.pinned)return-1;if(!a.pinned&&b.pinned)return 1;
    return(b.updatedAt||b.id)-(a.updatedAt||a.id);
  });
  if(S.activeTag)notes=notes.filter(n=>(n.tags||[]).includes(S.activeTag));
  if(q)notes=notes.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.text||'').toLowerCase().includes(q));
  // Tag bar
  const allTags=[...new Set(S.notes.flatMap(n=>n.tags||[]))];
  document.getElementById('tag-filter-bar').innerHTML=[
    `<div style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:${S.activeTag===null?'var(--accent)':'rgba(255,255,255,.07)'};color:${S.activeTag===null?'#fff':'var(--text2)'};border:1px solid ${S.activeTag===null?'var(--accent)':'var(--border)'}" onclick="filterTag(null)">Tutte</div>`,
    ...allTags.map(t=>`<div style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;background:${S.activeTag===t?'var(--accent)':'rgba(255,255,255,.07)'};color:${S.activeTag===t?'#fff':'var(--text2)'};border:1px solid ${S.activeTag===t?'var(--accent)':'var(--border)'}" onclick="filterTag('${t}')">#${t}</div>`)
  ].join('');
  if(!notes.length){document.getElementById('notes-grid').innerHTML=`<div style="text-align:center;color:var(--text2);padding:60px 20px;font-size:14px;grid-column:span 2">Nessuna nota.<br>Premi ＋ per crearne una.</div>`;return;}
  document.getElementById('notes-grid').innerHTML=notes.map(n=>{
    const firstImg=(n.blocks||[]).find(b=>b.type==='image');
    const checks=(n.blocks||[]).filter(b=>b.type==='checklist').flatMap(b=>b.items||[]);
    return`<div class="note-card nc-${n.color||'default'}${n.pinned?' pinned':''}" onclick="openEditor(${n.id})">
      ${firstImg?`<img class="note-img-prev" src="${firstImg.src}" alt="">`:'' }
      ${n.title?`<div class="note-title">${esc(n.title)}</div>`:''}
      ${checks.length?`<div style="font-size:12px;color:var(--text2);margin-bottom:4px">${checks.slice(0,3).map(c=>`${c.done?'☑':'☐'} ${esc(c.text)}`).join('<br>')}</div>`:''}
      ${n.text?`<div class="note-preview">${esc(n.text)}</div>`:''}
      <div class="note-footer">
        <div class="note-tags">${(n.tags||[]).map(t=>`<span class="note-tag">#${t}</span>`).join('')}</div>
        <div class="note-date">${fmtDate(n.updatedAt||n.id)}</div>
      </div>
    </div>`;
  }).join('');
}
function filterTag(t){S.activeTag=t;renderNotes();}

function openEditor(id){
  S.curNote=id?S.notes.find(n=>n.id===id):null;
  const n=S.curNote;
  document.getElementById('editor-title').value=n?n.title||'':'';
  document.getElementById('note-text').value=n?n.text||'':'';
  S.noteBlocks=n?JSON.parse(JSON.stringify(n.blocks||[])):[];
  S.notePin=n?n.pinned||false:false;
  S.noteColor=n?n.color||'default':'default';
  S.noteTags=n?[...(n.tags||[])]:[];
  document.getElementById('btn-pin').className='ed-btn'+(S.notePin?' on':'');
  document.getElementById('color-bar').className='';
  document.getElementById('tag-bar').className='';
  document.getElementById('note-editor').style.background=getBg(S.noteColor);
  document.getElementById('editor-body').style.background=getBg(S.noteColor);
  document.getElementById('editor-header').style.background=getBg(S.noteColor);
  renderEditorTags();renderBlocks();
  document.getElementById('note-editor').classList.add('open');
  document.getElementById('notes-fab').classList.remove('visible');
}
async function closeEditor(){
  await saveNote();
  document.getElementById('note-editor').classList.remove('open');
  document.getElementById('notes-fab').classList.add('visible');
  await loadNotes();renderNotes();updateHomeWidgets();
}
async function saveNote(){
  const title=document.getElementById('editor-title').value.trim();
  const text=document.getElementById('note-text').value.trim();
  const blocks=collectBlocks();
  if(!title&&!text&&!blocks.length){if(S.curNote)await dbDel('notes',S.curNote.id);return;}
  const id=S.curNote?S.curNote.id:Date.now();
  await dbPut('notes',{id,title,text,blocks,pinned:S.notePin,color:S.noteColor,tags:S.noteTags,createdAt:S.curNote?S.curNote.createdAt:Date.now(),updatedAt:Date.now()});
}
function collectBlocks(){
  const blocks=[];
  document.querySelectorAll('#note-blocks .note-block').forEach(el=>{
    const type=el.dataset.type;
    if(type==='image'){
      const canvas=el.querySelector('canvas');const img=el.querySelector('img');
      if(img)blocks.push({type:'image',src:mergeCanvas(canvas,img)});
    } else if(type==='checklist'){
      const items=[];
      el.querySelectorAll('.check-item').forEach(ci=>items.push({text:ci.querySelector('.check-text').value,done:ci.querySelector('.check-box').classList.contains('on')}));
      blocks.push({type:'checklist',items});
    } else if(type==='divider')blocks.push({type:'divider'});
  });
  return blocks;
}
function mergeCanvas(canvas,img){
  const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
  const sx=c.width/(canvas.offsetWidth||1),sy=c.height/(canvas.offsetHeight||1);
  const data=canvas.dataset.circles?JSON.parse(canvas.dataset.circles):[];
  data.forEach(({x,y,r,color})=>{ctx.beginPath();ctx.arc(x*sx,y*sy,r*Math.max(sx,sy),0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();});
  return c.toDataURL('image/jpeg',.85);
}
function renderBlocks(){
  const cont=document.getElementById('note-blocks');cont.innerHTML='';
  S.noteBlocks.forEach((b,i)=>{
    const div=document.createElement('div');div.className='note-block';div.dataset.type=b.type;div.dataset.idx=i;
    if(b.type==='image')div.innerHTML=buildImgBlock(b.src||'',i);
    else if(b.type==='checklist')div.innerHTML=buildChecklist(b.items||[],i);
    else if(b.type==='divider')div.innerHTML=`<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:8px 0">`;
    cont.appendChild(div);
  });
}
function buildImgBlock(src,idx){
  return`<div class="img-wrap" id="iw-${idx}">
    <img src="${src}" id="ni-${idx}" onload="initCanvas(${idx})">
    <canvas id="nc-${idx}" data-circles="[]" data-cm="false"></canvas>
  </div>
  <div class="img-toolbar">
    <button class="img-tool" id="cb-${idx}" onclick="toggleCM(${idx})">⭕ Cerchi</button>
    <div class="cc-row">
      ${['#ef4444','#3b82f6','#22c55e','#f59e0b'].map(c=>`<div class="cc${c==='#ef4444'?' sel':''}" style="background:${c}" onclick="setCC('${c}',this,${idx})"></div>`).join('')}
    </div>
    <button class="img-tool" onclick="clearCircles(${idx})">🗑 Cancella</button>
    <button class="img-tool" style="color:var(--red)" onclick="rmBlock(${idx})">✕</button>
  </div>`;
}
function initCanvas(idx){
  const img=document.getElementById(`ni-${idx}`);const canvas=document.getElementById(`nc-${idx}`);
  if(!img||!canvas)return;
  canvas.width=img.offsetWidth;canvas.height=img.offsetHeight;
  canvas.style.width=img.offsetWidth+'px';canvas.style.height=img.offsetHeight+'px';
  canvas.addEventListener('click',e=>onCanvasClick(e,canvas,idx));
}
function onCanvasClick(e,canvas,idx){
  if(canvas.dataset.cm!=='true')return;
  const rect=canvas.getBoundingClientRect();const x=e.clientX-rect.left;const y=e.clientY-rect.top;
  const r=Math.min(canvas.offsetWidth,canvas.offsetHeight)*.12;
  const circles=JSON.parse(canvas.dataset.circles||'[]');
  circles.push({x,y,r,color:canvas.dataset.cc||'#ef4444'});
  canvas.dataset.circles=JSON.stringify(circles);redrawCanvas(canvas);
}
function redrawCanvas(canvas){
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  JSON.parse(canvas.dataset.circles||'[]').forEach(({x,y,r,color})=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=color;ctx.lineWidth=3;ctx.stroke();});
}
function toggleCM(idx){
  const canvas=document.getElementById(`nc-${idx}`);const btn=document.getElementById(`cb-${idx}`);
  const on=canvas.dataset.cm==='true';canvas.dataset.cm=on?'false':'true';
  canvas.style.pointerEvents=on?'none':'auto';btn.className='img-tool'+(on?'':' on');btn.textContent=on?'⭕ Cerchi':'⭕ Attivo';
}
function setCC(color,el,idx){el.closest('.cc-row').querySelectorAll('.cc').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');document.getElementById(`nc-${idx}`).dataset.cc=color;}
function clearCircles(idx){const c=document.getElementById(`nc-${idx}`);c.dataset.circles='[]';c.getContext('2d').clearRect(0,0,c.width,c.height);}
function buildChecklist(items,idx){
  const rows=items.map((it,i)=>`<div class="check-item"><div class="check-box${it.done?' on':''}" onclick="togCheck(this)"></div><input class="check-text${it.done?' done':''}" value="${esc(it.text)}" placeholder="Elemento..."><button class="check-del" onclick="this.closest('.check-item').remove()">✕</button></div>`).join('');
  return`<div class="checklist-wrap"><div>${rows}</div><button class="add-check" onclick="addCI(this)">+ Aggiungi elemento</button><div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="img-tool" style="color:var(--red)" onclick="this.closest('.note-block').remove()">✕ Rimuovi</button></div></div>`;
}
function togCheck(el){el.classList.toggle('on');el.nextElementSibling.classList.toggle('done',el.classList.contains('on'));}
function addCI(btn){
  const div=document.createElement('div');div.className='check-item';
  div.innerHTML=`<div class="check-box" onclick="togCheck(this)"></div><input class="check-text" placeholder="..."><button class="check-del" onclick="this.closest('.check-item').remove()">✕</button>`;
  btn.previousElementSibling.appendChild(div);div.querySelector('.check-text').focus();
}
function addImgBlock(){document.getElementById('input-note-img').click();}
function onNoteImg(inp){
  const f=inp.files[0];if(!f)return;
  resize(f,1200,src=>{
    const idx=S.noteBlocks.length;S.noteBlocks.push({type:'image',src});
    const div=document.createElement('div');div.className='note-block';div.dataset.type='image';div.dataset.idx=idx;
    div.innerHTML=buildImgBlock(src,idx);document.getElementById('note-blocks').appendChild(div);
    setTimeout(()=>initCanvas(idx),100);
  });
  inp.value='';
}
function addCheckBlock(){
  const idx=S.noteBlocks.length;S.noteBlocks.push({type:'checklist',items:[]});
  const div=document.createElement('div');div.className='note-block';div.dataset.type='checklist';div.dataset.idx=idx;
  div.innerHTML=buildChecklist([],idx);document.getElementById('note-blocks').appendChild(div);
}
function addDivider(){
  S.noteBlocks.push({type:'divider'});
  const div=document.createElement('div');div.className='note-block';div.dataset.type='divider';
  div.innerHTML=`<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:8px 0">`;
  document.getElementById('note-blocks').appendChild(div);
}
function rmBlock(idx){const el=document.querySelector(`[data-idx="${idx}"]`);if(el)el.remove();}
function togglePin(){S.notePin=!S.notePin;document.getElementById('btn-pin').className='ed-btn'+(S.notePin?' on':'');}
function toggleColorBar(){const b=document.getElementById('color-bar');b.className=b.className==='show'?'':' show';}
function setColor(c,el){S.noteColor=c;document.querySelectorAll('.cswatch').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');const bg=getBg(c);document.getElementById('note-editor').style.background=bg;document.getElementById('editor-body').style.background=bg;document.getElementById('editor-header').style.background=bg;}
function toggleTagBar(){const b=document.getElementById('tag-bar');b.className=b.className.includes('show')?'tag-bar':'tag-bar show';}
function renderEditorTags(){document.getElementById('current-tags').innerHTML=S.noteTags.map(t=>`<div class="ed-tag">#${t}<span class="ed-tag-x" onclick="rmTag('${t}')">×</span></div>`).join('');}
function onTagKey(e){if(e.key==='Enter'||e.key===','){e.preventDefault();const v=e.target.value.trim().toLowerCase().replace(/[^a-z0-9àèìòù_-]/gi,'');if(v&&!S.noteTags.includes(v)){S.noteTags.push(v);renderEditorTags();}e.target.value='';}}
function rmTag(t){S.noteTags=S.noteTags.filter(x=>x!==t);renderEditorTags();}
async function deleteNote(){
  if(!S.curNote||!confirm('Eliminare questa nota?'))return;
  await dbDel('notes',S.curNote.id);
  document.getElementById('note-editor').classList.remove('open');
  document.getElementById('notes-fab').classList.add('visible');
  await loadNotes();renderNotes();updateHomeWidgets();
}
function getBg(c){const m={default:'#070710',red:'#1a0808',orange:'#1a1008',yellow:'#16140a',green:'#081a10',blue:'#080f1a',purple:'#10081a',pink:'#1a0810'};return m[c]||'#070710';}


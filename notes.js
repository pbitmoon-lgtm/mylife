// ═══════════════════════════════════════════════════════
// My Life — notes.js
// M1.2: Note cifrate stile Google Keep
// Modulo UI "stupido" — salva via INTENT_SAVE_RECORD
// ═══════════════════════════════════════════════════════

import State from './state.js';
import UI    from './ui.js';

const NotesModule = (() => {

  let _notes    = [];
  let _current  = null;
  let _blocks   = [];
  let _pinned   = false;
  let _color    = 'default';
  let _tags     = [];
  let _activeTag = null;
  let _recovWords = [];

  const COLORS = {
    default:'rgba(255,255,255,.05)',
    red:    'rgba(192,57,43,.18)',
    orange: 'rgba(230,126,34,.15)',
    yellow: 'rgba(241,196,15,.12)',
    green:  'rgba(39,174,96,.15)',
    blue:   'rgba(41,128,185,.18)',
    purple: 'rgba(142,68,173,.18)',
    pink:   'rgba(233,30,140,.15)',
  };

  const BORDERS = {
    default:'rgba(255,255,255,.1)',
    red:    'rgba(192,57,43,.35)',
    orange: 'rgba(230,126,34,.3)',
    yellow: 'rgba(241,196,15,.25)',
    green:  'rgba(39,174,96,.3)',
    blue:   'rgba(41,128,185,.35)',
    purple: 'rgba(142,68,173,.35)',
    pink:   'rgba(233,30,140,.3)',
  };

  // ─── CARICA NOTE ──────────────────────────────────────
  let _loading    = false;
  let _loadedIds  = new Set();

  function load() {
    _notes = []; _loadedIds.clear(); _loading = true;
    State.dispatch('INTENT_LOAD_RECORDS', { type:'note', requestId:'notes_list' });
  }

  // Ascolta SOLO i payload con requestId di questo modulo
  State.subscribe('PAYLOAD_DECRYPTED', ({ id, payload, isAsset, requestId }) => {
    if (isAsset || !payload) return;
    if (requestId !== 'notes_list') return;          // ignora altri moduli
    if (payload.type !== 'note') return;
    if (_loadedIds.has(id)) return;
    _loadedIds.add(id);
    _notes.push({ ...payload, id });
    render();
  });

  State.subscribe('RECORDS_LOAD_STARTED', ({ requestId, count }) => {
    if (requestId !== 'notes_list') return;
    _loading = false;
    if (count === 0) render();                       // lista vuota → stato vuoto
  });

  // ─── RENDER GRIGLIA ───────────────────────────────────
  function render() {
    const q = (document.getElementById('notes-search')?.value||'').toLowerCase();
    let list = [..._notes].sort((a,b) => {
      if (a.pinned&&!b.pinned) return -1;
      if (!a.pinned&&b.pinned) return 1;
      return (b.updatedAt||b.id)-(a.updatedAt||a.id);
    });
    if (_activeTag) list = list.filter(n=>(n.tags||[]).includes(_activeTag));
    if (q) list = list.filter(n=>
      (n.title||'').toLowerCase().includes(q)||(n.text||'').toLowerCase().includes(q)
    );

    // Tag bar
    const allTags = [...new Set(_notes.flatMap(n=>n.tags||[]))];
    const tagBar  = document.getElementById('notes-tag-bar');
    if (tagBar) tagBar.innerHTML = [
      `<span class="tag-chip${!_activeTag?' active':''}" onclick="NotesModule.filterTag(null)">Tutte</span>`,
      ...allTags.map(t=>
        `<span class="tag-chip${_activeTag===t?' active':''}" onclick="NotesModule.filterTag('${t}')">#${t}</span>`)
    ].join('');

    // Grid
    const grid = document.getElementById('notes-grid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML=`<div style="text-align:center;color:var(--text2);padding:60px 20px;font-size:14px;grid-column:span 2">
        Nessuna nota.<br>Premi + per crearne una.</div>`;
    } else {
      grid.innerHTML = list.map(n => `
        <div class="note-card${n.pinned?' pinned':''}"
          style="background:${COLORS[n.color||'default']};border-color:${BORDERS[n.color||'default']}"
          onclick="NotesModule.openEditor(${n.id})">
          ${n.title?`<div class="note-title">${UI.esc(n.title)}</div>`:''}
          ${n.text?`<div class="note-preview">${UI.esc(n.text)}</div>`:''}
          <div class="note-footer">
            <div class="note-tags">${(n.tags||[]).map(t=>`<span class="ntag">#${t}</span>`).join('')}</div>
            <div class="note-date">${UI.fmtDate(n.updatedAt||n.id)}</div>
          </div>
        </div>`).join('');
    }

    // Aggiorna badge home
    const badge = document.getElementById('w-notes-badge');
    if (badge) badge.textContent = _notes.length+' note';
  }

  function filterTag(tag) { _activeTag=tag; render(); }

  // ─── EDITOR ───────────────────────────────────────────
  function openEditor(id) {
    const n   = id ? _notes.find(x=>x.id===id) : null;
    _current  = n;
    _blocks   = n ? JSON.parse(JSON.stringify(n.blocks||[])) : [];
    _pinned   = n ? n.pinned||false : false;
    _color    = n ? n.color||'default' : 'default';
    _tags     = n ? [...(n.tags||[])] : [];

    document.getElementById('ed-title').value = n?n.title||'':'';
    document.getElementById('ed-text').value  = n?n.text||'':'';
    document.getElementById('ed-pin').className='ed-btn'+(n?.pinned?' on':'');
    document.getElementById('color-bar').style.display='none';
    document.getElementById('tag-bar-ed').style.display='none';
    document.getElementById('note-editor').style.background=COLORS[_color];
    renderTags(); renderBlocks();
    document.getElementById('note-editor').classList.add('open');
    document.getElementById('notes-fab').classList.remove('visible');
  }

  async function closeEditor() {
    saveNote();
    document.getElementById('note-editor').classList.remove('open');
    document.getElementById('notes-fab').classList.add('visible');
    // Ricarica note
    setTimeout(()=>{ load(); }, 200);
  }

  function saveNote() {
    const title  = document.getElementById('ed-title').value.trim();
    const text   = document.getElementById('ed-text').value.trim();
    const blocks = collectBlocks();
    if (!title && !text && !blocks.length) {
      if (_current) State.dispatch('INTENT_DELETE_RECORD',{id:_current.id});
      return;
    }
    const id = _current ? _current.id : Date.now();
    State.dispatch('INTENT_SAVE_RECORD', {
      recordId:    id,
      type:        'note',
      textPayload: {
        title, text, blocks,
        pinned:    _pinned,
        color:     _color,
        tags:      _tags,
        createdAt: _current ? _current.createdAt : Date.now(),
        updatedAt: Date.now(),
      }
    });
  }

  function collectBlocks() {
    const blocks = [];
    document.querySelectorAll('#ed-blocks .nb').forEach(el => {
      const type = el.dataset.type;
      if (type==='checklist') {
        const items=[];
        el.querySelectorAll('.ci').forEach(ci=>items.push({
          text:ci.querySelector('.ci-text').value,
          done:ci.querySelector('.ci-box').classList.contains('on')
        }));
        blocks.push({type:'checklist',items});
      } else if (type==='divider') {
        blocks.push({type:'divider'});
      }
    });
    return blocks;
  }

  function renderBlocks() {
    const cont = document.getElementById('ed-blocks');
    if (!cont) return;
    cont.innerHTML='';
    _blocks.forEach((b,i)=>{
      const div=document.createElement('div');
      div.className='nb'; div.dataset.type=b.type; div.dataset.idx=i;
      if (b.type==='checklist') div.innerHTML=buildChecklist(b.items||[]);
      else if (b.type==='divider') div.innerHTML='<hr class="nb-divider">';
      cont.appendChild(div);
    });
  }

  function buildChecklist(items) {
    const rows=items.map(it=>
      `<div class="ci">
        <div class="ci-box${it.done?' on':''}" onclick="this.classList.toggle('on');this.nextElementSibling.classList.toggle('done',this.classList.contains('on'))"></div>
        <input class="ci-text${it.done?' done':''}" value="${UI.esc(it.text)}" placeholder="Elemento...">
        <button class="ci-del" onclick="this.closest('.ci').remove()">✕</button>
      </div>`
    ).join('');
    return `<div class="nb-checklist">
      <div>${rows}</div>
      <button class="add-ci" onclick="NotesModule.addCI(this)">+ Aggiungi</button>
      <button class="nb-tool danger" onclick="this.closest('.nb').remove()">✕ Rimuovi</button>
    </div>`;
  }

  function addCI(btn) {
    const div=document.createElement('div'); div.className='ci';
    div.innerHTML=`<div class="ci-box" onclick="this.classList.toggle('on');this.nextElementSibling.classList.toggle('done',this.classList.contains('on'))"></div>
      <input class="ci-text" placeholder="...">
      <button class="ci-del" onclick="this.closest('.ci').remove()">✕</button>`;
    btn.previousElementSibling.appendChild(div);
    div.querySelector('.ci-text').focus();
  }

  function addChecklist() {
    _blocks.push({type:'checklist',items:[]});
    const div=document.createElement('div'); div.className='nb'; div.dataset.type='checklist';
    div.innerHTML=buildChecklist([]);
    document.getElementById('ed-blocks').appendChild(div);
  }

  function addDivider() {
    _blocks.push({type:'divider'});
    const div=document.createElement('div'); div.className='nb'; div.dataset.type='divider';
    div.innerHTML='<hr class="nb-divider">';
    document.getElementById('ed-blocks').appendChild(div);
  }

  function togglePin() {
    _pinned=!_pinned;
    document.getElementById('ed-pin').className='ed-btn'+(_pinned?' on':'');
  }

  function toggleColorBar() {
    const b=document.getElementById('color-bar');
    b.style.display=b.style.display==='flex'?'none':'flex';
  }

  function setColor(color,el) {
    _color=color;
    document.querySelectorAll('.cswatch').forEach(e=>e.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById('note-editor').style.background=COLORS[color];
  }

  function toggleTagBar() {
    const b=document.getElementById('tag-bar-ed');
    b.style.display=b.style.display==='flex'?'none':'flex';
  }

  function renderTags() {
    const el=document.getElementById('ed-current-tags');
    if (!el) return;
    el.innerHTML=_tags.map(t=>
      `<span class="ed-tag">#${t}<span onclick="NotesModule.removeTag('${t}')">×</span></span>`
    ).join('');
  }

  function onTagKey(e) {
    if (e.key==='Enter'||e.key===',') {
      e.preventDefault();
      const v=e.target.value.trim().toLowerCase().replace(/[^a-z0-9àèìòù_-]/gi,'');
      if (v&&!_tags.includes(v)){_tags.push(v);renderTags();}
      e.target.value='';
    }
  }

  function removeTag(t) { _tags=_tags.filter(x=>x!==t); renderTags(); }

  function deleteNote() {
    if (!_current||!confirm('Eliminare questa nota?')) return;
    State.dispatch('INTENT_DELETE_RECORD',{id:_current.id});
    document.getElementById('note-editor').classList.remove('open');
    document.getElementById('notes-fab').classList.add('visible');
    _notes=_notes.filter(n=>n.id!==_current.id);
    render();
  }

  State.subscribe('APP_READY', () => { console.log('[notes] pronto'); });

  const pub = {
    load, render, filterTag, openEditor, closeEditor, saveNote,
    addCI, addChecklist, addDivider,
    togglePin, toggleColorBar, setColor, toggleTagBar,
    onTagKey, removeTag, deleteNote
  };
  window.NotesModule = pub;
  return pub;

})();

export default NotesModule;

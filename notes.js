// ═══════════════════════════════════════════════
// My Life — notes.js  v1.0
// M1.2: Note cifrate stile Google Keep
// Griglia · colori · tag · checklist · immagini annotate
// Dipende da: crypto.js, db.js
// ═══════════════════════════════════════════════

const NOTES = {

  notes: [],
  current: null,
  blocks: [],
  pinned: false,
  color: 'default',
  tags: [],
  activeTag: null,
  words: [],

  COLORS: {
    default: {bg:'rgba(255,255,255,.05)', border:'rgba(255,255,255,.1)'},
    red:     {bg:'rgba(192,57,43,.18)',   border:'rgba(192,57,43,.35)'},
    orange:  {bg:'rgba(230,126,34,.15)',  border:'rgba(230,126,34,.3)'},
    yellow:  {bg:'rgba(241,196,15,.12)',  border:'rgba(241,196,15,.25)'},
    green:   {bg:'rgba(39,174,96,.15)',   border:'rgba(39,174,96,.3)'},
    blue:    {bg:'rgba(41,128,185,.18)',  border:'rgba(41,128,185,.35)'},
    purple:  {bg:'rgba(142,68,173,.18)', border:'rgba(142,68,173,.35)'},
    pink:    {bg:'rgba(233,30,140,.15)', border:'rgba(233,30,140,.3)'},
  },

  async load() {
    this.notes = await dbAll('notes');
  },

  render() {
    const q = (document.getElementById('notes-search')?.value || '').toLowerCase();
    let list = [...this.notes].sort((a,b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updatedAt||b.id) - (a.updatedAt||a.id);
    });
    if (this.activeTag) list = list.filter(n => (n.tags||[]).includes(this.activeTag));
    if (q) list = list.filter(n =>
      (n.title||'').toLowerCase().includes(q) ||
      (n.text||'').toLowerCase().includes(q)
    );

    // Tag bar
    const allTags = [...new Set(this.notes.flatMap(n => n.tags||[]))];
    const tagBar = document.getElementById('notes-tag-bar');
    if (tagBar) tagBar.innerHTML = [
      `<span class="tag-chip${!this.activeTag?' active':''}" onclick="NOTES.filterTag(null)">Tutte</span>`,
      ...allTags.map(t =>
        `<span class="tag-chip${this.activeTag===t?' active':''}" onclick="NOTES.filterTag('${t}')">#${t}</span>`)
    ].join('');

    // Grid
    const grid = document.getElementById('notes-grid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = `<div style="text-align:center;color:var(--text2);padding:60px 20px;font-size:14px;grid-column:span 2">
        Nessuna nota.<br>Premi + per crearne una.</div>`;
      return;
    }
    grid.innerHTML = list.map(n => {
      const col = this.COLORS[n.color||'default'];
      const firstImg = (n.blocks||[]).find(b => b.type==='image');
      const checks   = (n.blocks||[]).filter(b => b.type==='checklist').flatMap(b => b.items||[]);
      return `<div class="note-card${n.pinned?' pinned':''}"
        style="background:${col.bg};border-color:${col.border}"
        onclick="NOTES.openEditor(${n.id})">
        ${firstImg ? `<img class="note-img-prev" src="${firstImg.src}" alt="">` : ''}
        ${n.title ? `<div class="note-title">${esc(n.title)}</div>` : ''}
        ${checks.length ? `<div class="note-checks">${checks.slice(0,3).map(c=>`${c.done?'☑':'☐'} ${esc(c.text)}`).join('<br>')}</div>` : ''}
        ${n.text ? `<div class="note-preview">${esc(n.text)}</div>` : ''}
        <div class="note-footer">
          <div class="note-tags">${(n.tags||[]).map(t=>`<span class="ntag">#${t}</span>`).join('')}</div>
          <div class="note-date">${fmtDate(n.updatedAt||n.id)}</div>
        </div>
      </div>`;
    }).join('');

    // Update home widget badge
    const badge = document.getElementById('w-notes-badge');
    if (badge) badge.textContent = this.notes.length + ' note';
  },

  filterTag(tag) {
    this.activeTag = tag;
    this.render();
  },

  openEditor(id) {
    const n = id ? this.notes.find(x => x.id === id) : null;
    this.current = n;
    this.blocks  = n ? JSON.parse(JSON.stringify(n.blocks||[])) : [];
    this.pinned  = n ? n.pinned||false : false;
    this.color   = n ? n.color||'default' : 'default';
    this.tags    = n ? [...(n.tags||[])] : [];

    const ed = document.getElementById('note-editor');
    if (!ed) return;
    document.getElementById('ed-title').value = n ? n.title||'' : '';
    document.getElementById('ed-text').value  = n ? n.text||'' : '';
    document.getElementById('ed-pin').className = 'ed-btn' + (this.pinned ? ' on' : '');
    document.getElementById('color-bar').style.display = 'none';
    document.getElementById('tag-bar-ed').style.display = 'none';
    ed.style.background = this.COLORS[this.color].bg;

    this.renderTags();
    this.renderBlocks();
    ed.classList.add('open');
    document.getElementById('notes-fab').style.display = 'none';
  },

  async closeEditor() {
    await this.saveNote();
    document.getElementById('note-editor').classList.remove('open');
    document.getElementById('notes-fab').style.display = '';
    await this.load();
    this.render();
  },

  async saveNote() {
    const title  = document.getElementById('ed-title').value.trim();
    const text   = document.getElementById('ed-text').value.trim();
    const blocks = this.collectBlocks();
    if (!title && !text && !blocks.length) {
      if (this.current) await dbDel('notes', this.current.id);
      return;
    }
    const id = this.current ? this.current.id : Date.now();
    await dbPut('notes', {
      id, title, text, blocks,
      pinned: this.pinned, color: this.color, tags: this.tags,
      createdAt:  this.current ? this.current.createdAt : Date.now(),
      updatedAt:  Date.now()
    });
  },

  collectBlocks() {
    const blocks = [];
    document.querySelectorAll('#ed-blocks .nb').forEach(el => {
      const type = el.dataset.type;
      if (type === 'image') {
        const canvas = el.querySelector('canvas');
        const img    = el.querySelector('img');
        if (img) blocks.push({type:'image', src: this.mergeCanvas(canvas,img)});
      } else if (type === 'checklist') {
        const items = [];
        el.querySelectorAll('.ci').forEach(ci => {
          items.push({
            text: ci.querySelector('.ci-text').value,
            done: ci.querySelector('.ci-box').classList.contains('on')
          });
        });
        blocks.push({type:'checklist', items});
      } else if (type === 'divider') {
        blocks.push({type:'divider'});
      }
    });
    return blocks;
  },

  mergeCanvas(canvas, img) {
    const c   = document.createElement('canvas');
    c.width   = img.naturalWidth || img.width;
    c.height  = img.naturalHeight || img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const sx = c.width  / (canvas.offsetWidth  || 1);
    const sy = c.height / (canvas.offsetHeight || 1);
    try {
      const circles = JSON.parse(canvas.dataset.circles || '[]');
      circles.forEach(({x,y,r,color}) => {
        ctx.beginPath();
        ctx.arc(x*sx, y*sy, r*Math.max(sx,sy), 0, Math.PI*2);
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
      });
    } catch {}
    return c.toDataURL('image/jpeg', .85);
  },

  renderBlocks() {
    const cont = document.getElementById('ed-blocks');
    if (!cont) return;
    cont.innerHTML = '';
    this.blocks.forEach((b,i) => {
      const div = document.createElement('div');
      div.className = 'nb'; div.dataset.type = b.type; div.dataset.idx = i;
      if (b.type === 'image')      div.innerHTML = this.buildImgBlock(b.src||'', i);
      else if (b.type === 'checklist') div.innerHTML = this.buildChecklist(b.items||[], i);
      else if (b.type === 'divider')   div.innerHTML = '<hr class="nb-divider">';
      cont.appendChild(div);
    });
  },

  buildImgBlock(src, idx) {
    return `<div class="nb-img-wrap" id="nbw-${idx}">
      <img src="${src}" id="nbimg-${idx}" onload="NOTES.initCanvas(${idx})">
      <canvas id="nbcv-${idx}" data-circles="[]" data-cm="false"></canvas>
    </div>
    <div class="nb-toolbar">
      <button class="nb-tool" id="nb-cm-${idx}" onclick="NOTES.toggleCM(${idx})">⭕ Cerchi</button>
      <div class="nb-colors">
        ${['#ef4444','#3b82f6','#22c55e','#f59e0b'].map(col=>
          `<div class="nb-col${col==='#ef4444'?' sel':''}" style="background:${col}"
            onclick="NOTES.setCC('${col}',this,${idx})"></div>`
        ).join('')}
      </div>
      <button class="nb-tool" onclick="NOTES.clearCircles(${idx})">🗑</button>
      <button class="nb-tool danger" onclick="this.closest('.nb').remove()">✕</button>
    </div>`;
  },

  initCanvas(idx) {
    const img = document.getElementById(`nbimg-${idx}`);
    const cv  = document.getElementById(`nbcv-${idx}`);
    if (!img || !cv) return;
    cv.width  = img.offsetWidth;
    cv.height = img.offsetHeight;
    cv.style.width  = img.offsetWidth  + 'px';
    cv.style.height = img.offsetHeight + 'px';
    cv.addEventListener('click', e => {
      if (cv.dataset.cm !== 'true') return;
      const r   = cv.getBoundingClientRect();
      const circles = JSON.parse(cv.dataset.circles || '[]');
      circles.push({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        r: Math.min(cv.offsetWidth, cv.offsetHeight) * .12,
        color: cv.dataset.cc || '#ef4444'
      });
      cv.dataset.circles = JSON.stringify(circles);
      this.redrawCanvas(cv);
    });
  },

  redrawCanvas(cv) {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    try {
      JSON.parse(cv.dataset.circles || '[]').forEach(({x,y,r,color}) => {
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
      });
    } catch {}
  },

  toggleCM(idx) {
    const cv  = document.getElementById(`nbcv-${idx}`);
    const btn = document.getElementById(`nb-cm-${idx}`);
    const on  = cv.dataset.cm === 'true';
    cv.dataset.cm = on ? 'false' : 'true';
    cv.style.pointerEvents = on ? 'none' : 'auto';
    btn.className = 'nb-tool' + (on ? '' : ' on');
    btn.textContent = on ? '⭕ Cerchi' : '⭕ Attivo';
  },

  setCC(color, el, idx) {
    el.closest('.nb-colors').querySelectorAll('.nb-col').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById(`nbcv-${idx}`).dataset.cc = color;
  },

  clearCircles(idx) {
    const cv = document.getElementById(`nbcv-${idx}`);
    cv.dataset.circles = '[]';
    cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
  },

  buildChecklist(items, idx) {
    const rows = items.map((it,i) =>
      `<div class="ci">
        <div class="ci-box${it.done?' on':''}" onclick="this.classList.toggle('on');this.nextElementSibling.classList.toggle('done',this.classList.contains('on'))"></div>
        <input class="ci-text${it.done?' done':''}" value="${esc(it.text)}" placeholder="Elemento...">
        <button class="ci-del" onclick="this.closest('.ci').remove()">✕</button>
      </div>`
    ).join('');
    return `<div class="nb-checklist">
      <div class="ci-list">${rows}</div>
      <button class="add-ci" onclick="NOTES.addCI(this)">+ Aggiungi elemento</button>
      <button class="nb-tool danger" style="margin-top:6px" onclick="this.closest('.nb').remove()">✕ Rimuovi blocco</button>
    </div>`;
  },

  addCI(btn) {
    const div = document.createElement('div');
    div.className = 'ci';
    div.innerHTML = `<div class="ci-box" onclick="this.classList.toggle('on');this.nextElementSibling.classList.toggle('done',this.classList.contains('on'))"></div>
      <input class="ci-text" placeholder="Nuovo elemento...">
      <button class="ci-del" onclick="this.closest('.ci').remove()">✕</button>`;
    btn.previousElementSibling.appendChild(div);
    div.querySelector('.ci-text').focus();
  },

  addImage() {
    document.getElementById('note-img-in').click();
  },

  onImgSelected(inp) {
    const f = inp.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1200/img.width, 1);
      const c = document.createElement('canvas');
      c.width = img.width*r; c.height = img.height*r;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      const src = c.toDataURL('image/jpeg',.8);
      const idx = this.blocks.length;
      this.blocks.push({type:'image', src});
      const div = document.createElement('div');
      div.className = 'nb'; div.dataset.type = 'image'; div.dataset.idx = idx;
      div.innerHTML = this.buildImgBlock(src, idx);
      document.getElementById('ed-blocks').appendChild(div);
      setTimeout(() => this.initCanvas(idx), 100);
    };
    img.src = URL.createObjectURL(f);
    inp.value = '';
  },

  addChecklist() {
    const idx = this.blocks.length;
    this.blocks.push({type:'checklist', items:[]});
    const div = document.createElement('div');
    div.className = 'nb'; div.dataset.type = 'checklist'; div.dataset.idx = idx;
    div.innerHTML = this.buildChecklist([], idx);
    document.getElementById('ed-blocks').appendChild(div);
  },

  addDivider() {
    this.blocks.push({type:'divider'});
    const div = document.createElement('div');
    div.className = 'nb'; div.dataset.type = 'divider';
    div.innerHTML = '<hr class="nb-divider">';
    document.getElementById('ed-blocks').appendChild(div);
  },

  togglePin() {
    this.pinned = !this.pinned;
    document.getElementById('ed-pin').className = 'ed-btn' + (this.pinned ? ' on' : '');
  },

  toggleColorBar() {
    const bar = document.getElementById('color-bar');
    bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
  },

  setColor(color, el) {
    this.color = color;
    document.querySelectorAll('.cswatch').forEach(e => e.classList.remove('sel'));
    el.classList.add('sel');
    document.getElementById('note-editor').style.background = this.COLORS[color].bg;
  },

  toggleTagBar() {
    const bar = document.getElementById('tag-bar-ed');
    bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
  },

  renderTags() {
    const el = document.getElementById('ed-current-tags');
    if (!el) return;
    el.innerHTML = this.tags.map(t =>
      `<span class="ed-tag">#${t}<span onclick="NOTES.removeTag('${t}')">×</span></span>`
    ).join('');
  },

  onTagKey(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = e.target.value.trim().toLowerCase().replace(/[^a-z0-9àèìòù_-]/gi,'');
      if (v && !this.tags.includes(v)) { this.tags.push(v); this.renderTags(); }
      e.target.value = '';
    }
  },

  removeTag(t) {
    this.tags = this.tags.filter(x => x !== t);
    this.renderTags();
  },

  async deleteNote() {
    if (!this.current) return;
    if (!confirm('Eliminare questa nota?')) return;
    await dbDel('notes', this.current.id);
    document.getElementById('note-editor').classList.remove('open');
    document.getElementById('notes-fab').style.display = '';
    await this.load();
    this.render();
  }
};

window.NOTES = NOTES;

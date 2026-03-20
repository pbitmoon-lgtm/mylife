// ═══════════════════════════════════════════════
// My Life — settings.js  v1.0
// Impostazioni, lingua, export, reset
// Dipende da: crypto.js, db.js
// ═══════════════════════════════════════════════

const SETTINGS = {

  load() {
    try {
      const s = JSON.parse(localStorage.getItem('ml_settings') || '{}');
      return { lang: s.lang||'it', autoMode: s.autoMode||false, sensitivity: s.sensitivity||'medium' };
    } catch { return {lang:'it', autoMode:false, sensitivity:'medium'}; }
  },

  save(data) {
    localStorage.setItem('ml_settings', JSON.stringify(data));
  },

  async exportAll() {
    try {
      const trips     = await dbAll('trips');
      const favorites = await dbAll('favorites');
      const notes     = await dbAll('notes');
      const blob = new Blob(
        [JSON.stringify({trips, favorites, notes, exportedAt: new Date().toISOString()}, null, 2)],
        {type:'application/json'}
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mylife_backup_${Date.now()}.json`;
      a.click();
    } catch(e) { alert('Errore export: ' + e.message); }
  },

  async clearAll() {
    if (!confirm('Cancellare TUTTI i dati?\nQuesta operazione non è reversibile.')) return;
    for (const store of ['trips','favorites','notes']) {
      const items = await dbAll(store);
      for (const item of items) await dbDel(store, item.id);
    }
    alert('Dati cancellati.');
  }
};

window.SETTINGS = SETTINGS;

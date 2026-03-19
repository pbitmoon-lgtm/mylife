// ═══════════════════════════════════════════════
// My Life — db.js
// IndexedDB wrapper con cifratura trasparente
// Dipendenze: crypto.js (window.CE)
// Esporta: window.DB (dbAll, dbPut, dbDel)
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════════════
let db;
async function initDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open('MyLife',2);
    r.onupgradeneeded=e=>{
      const d=e.target.result;
      ['trips','favorites','notes'].forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'})});
    };
    r.onsuccess=e=>{db=e.target.result;res()};
    r.onerror=()=>rej(r.error);
  });
}
async function dbAll(store){
  return new Promise(async(res,rej)=>{
    const tx=db.transaction(store,'readonly');
    const r=tx.objectStore(store).getAll();
    r.onsuccess=async()=>{
      const out=[];
      for(const row of r.result){
        try{out.push({...await CE.dec(row.data||row),id:row.id})}
        catch{out.push(row)}
      }
      res(out);
    };
    r.onerror=()=>rej(r.error);
  });
}
async function dbPut(store,obj){
  const{id,...data}=obj;
  const enc=await CE.enc(data);
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    const r=tx.objectStore(store).put({id:id||Date.now(),data:enc});
    r.onsuccess=()=>res();r.onerror=()=>rej(r.error);
  });
}
async function dbDel(store,id){
  return new Promise((res,rej)=>{
    const tx=db.transaction(store,'readwrite');
    const r=tx.objectStore(store).delete(id);
    r.onsuccess=()=>res();r.onerror=()=>rej(r.error);
  });
}



// Esponi come window.DB per gli altri moduli
window.DB = { dbAll, dbPut, dbDel };
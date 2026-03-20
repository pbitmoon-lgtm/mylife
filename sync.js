// ═══════════════════════════════════════════════
// My Life — sync.js  v0.1 PLACEHOLDER
// M3: Backup cifrato su Base blockchain
// Dipende da: crypto.js, auth.js
// ═══════════════════════════════════════════════
// TODO M3:
//   - Smart contract su Base (0x...)
//   - saveCredentials(userId, encBlob) → on-chain
//   - loadCredentials(userId) → da Base
//   - syncData(encBlob) → IPFS per dati grandi
//   - Costo: ~€0.001 per utente
// ═══════════════════════════════════════════════

const SYNC = {
  async saveCredentials(userId, encBlob) {
    console.log('[sync] placeholder — nessun backup remoto');
  },
  async loadCredentials(userId) {
    console.log('[sync] placeholder — nessun backup remoto');
    return null;
  }
};

window.SYNC = SYNC;

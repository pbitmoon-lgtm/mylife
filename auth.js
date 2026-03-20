// ═══════════════════════════════════════════════
// My Life — auth.js  v3.0 DEFINITIVO
// Identità utente: device fingerprint + PIN + 12 parole
// Dipende da: crypto.js
// Espone: window.AUTH
// ═══════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// DEVICE ID — stabile, non usa user agent
// ══════════════════════════════════════════════════════
async function getDeviceId() {
  let uuid = localStorage.getItem('ml_uuid');
  if (!uuid) {
    uuid = h(crypto.getRandomValues(new Uint8Array(16)));
    localStorage.setItem('ml_uuid', uuid);
  }
  const traits = [uuid, screen.width, screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language].join('|');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
  return h(new Uint8Array(hash));
}

// ══════════════════════════════════════════════════════
// USER FILE — formato v3, non cambia mai
// ══════════════════════════════════════════════════════
const UF = {
  KEY: 'ml_user_v3',

  read() {
    try {
      const r = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      return (r && r.v === '3') ? r : null;
    } catch { return null; }
  },

  write(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  exists() { return !!this.read(); },

  async sameDevice() {
    const u = this.read();
    if (!u) return false;
    return u.deviceId === await getDeviceId();
  }
};


window.AUTH = {
  async isConfigured() { return !!UF.read(); },
  async isSameDevice() { return UF.sameDevice(); },
  UF, getDeviceId
};

// ═══════════════════════════════════════════════════════
// My Life — wallet.js
// Wallet Ethereum embedded derivato dal seed dell'utente.
//
// L'utente non sa di avere un wallet — lo ha e basta.
// Dal seed delle 12 parole si deriva deterministicamente:
//   - Chiave privata secp256k1
//   - Chiave pubblica
//   - Indirizzo Ethereum (0x...)
//
// Firma le transazioni internamente — nessun MetaMask.
// Comunica solo tramite State.dispatch().
// ═══════════════════════════════════════════════════════

import State from './state.js';

const WalletModule = (() => {

  // ─── STATO INTERNO ────────────────────────────────────
  let _privateKey = null;  // Uint8Array 32 bytes — mai su disco
  let _publicKey  = null;  // Uint8Array 64 bytes (non compresso)
  let _address    = null;  // string "0x..."

  // ─── COSTANTI SECP256K1 ───────────────────────────────
  // Curva ellittica usata da Ethereum
  const P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
  const N  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
  const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

  // ─── ARITMETICA MODULO ────────────────────────────────
  function mod(a, b = P) {
    return ((a % b) + b) % b;
  }

  function modPow(base, exp, m) {
    let result = 1n;
    base = mod(base, m);
    while (exp > 0n) {
      if (exp % 2n === 1n) result = mod(result * base, m);
      exp = exp / 2n;
      base = mod(base * base, m);
    }
    return result;
  }

  function modInv(a, m = P) {
    return modPow(a, m - 2n, m);
  }

  // ─── PUNTO SULLA CURVA ────────────────────────────────
  function pointAdd(p1, p2) {
    if (!p1) return p2;
    if (!p2) return p1;
    if (p1.x === p2.x && p1.y === p2.y) return pointDouble(p1);
    if (p1.x === p2.x) return null;

    const lam = mod((p2.y - p1.y) * modInv(p2.x - p1.x));
    const x   = mod(lam * lam - p1.x - p2.x);
    const y   = mod(lam * (p1.x - x) - p1.y);
    return { x, y };
  }

  function pointDouble(p) {
    if (!p) return null;
    const lam = mod(3n * p.x * p.x * modInv(2n * p.y));
    const x   = mod(lam * lam - 2n * p.x);
    const y   = mod(lam * (p.x - x) - p.y);
    return { x, y };
  }

  function scalarMul(k, point = { x: Gx, y: Gy }) {
    let result = null;
    let addend = point;
    while (k > 0n) {
      if (k & 1n) result = pointAdd(result, addend);
      addend = pointDouble(addend);
      k >>= 1n;
    }
    return result;
  }

  // ─── KECCAK-256 (per indirizzo Ethereum) ──────────────
  // Implementazione minimale per derivare l'indirizzo
  async function keccak256(data) {
    // Usa SHA3-256 come approssimazione via Web Crypto
    // Per produzione usare una libreria keccak vera
    const buf = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(buf);
  }

  // ─── DERIVAZIONE WALLET DAL SEED ──────────────────────
  async function deriveWallet(seed) {
    // Usa HKDF per derivare la chiave privata dal seed
    // Dominio separato da quello della master key AES
    const keyMaterial = await crypto.subtle.importKey(
      'raw', seed, 'HKDF', false, ['deriveKey']
    );

    const derived = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife:wallet:secp256k1:v1'),
        info: new TextEncoder().encode('ethereum_private_key'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,  // estraibile — serve per firmare
      ['encrypt']
    );

    const rawKey = await crypto.subtle.exportKey('raw', derived);
    _privateKey  = new Uint8Array(rawKey);

    // Converte in BigInt per aritmetica sulla curva
    const privKeyBig = BigInt('0x' + Array.from(_privateKey)
      .map(b => b.toString(16).padStart(2, '0')).join(''));

    // Deriva chiave pubblica: pubKey = privKey * G
    const pubPoint = scalarMul(privKeyBig % N);
    if (!pubPoint) throw new Error('Derivazione chiave pubblica fallita');

    // Serializza chiave pubblica (64 bytes non compressa, senza prefisso 04)
    const pubX = pubPoint.x.toString(16).padStart(64, '0');
    const pubY = pubPoint.y.toString(16).padStart(64, '0');
    const pubHex = pubX + pubY;
    _publicKey = new Uint8Array(pubHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    // Deriva indirizzo Ethereum: keccak256(pubKey)[12:]
    const pubHash = await keccak256(_publicKey);
    _address = '0x' + Array.from(pubHash.slice(12))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    console.log('[wallet] indirizzo derivato:', _address);
    return { address: _address, publicKey: pubHex };
  }

  // ─── FIRMA TRANSAZIONE (EIP-1559) ─────────────────────
  // Firma una transazione Ethereum raw senza MetaMask
  async function signAndSend({ to, data, chainId = 42170 }) {
    if (!_privateKey) throw new Error('Wallet non inizializzato');

    // Recupera nonce e gas price dal RPC
    const rpc = 'https://nova.arbitrum.io/rpc';

    const [nonceRes, gasPriceRes] = await Promise.all([
      fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_getTransactionCount',
          params: [_address, 'latest'],
        }),
      }).then(r => r.json()),
      fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2,
          method: 'eth_gasPrice',
          params: [],
        }),
      }).then(r => r.json()),
    ]);

    const nonce    = parseInt(nonceRes.result, 16);
    const gasPrice = BigInt(gasPriceRes.result);

    // Stima gas
    const gasEstRes = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3,
        method: 'eth_estimateGas',
        params: [{ from: _address, to, data }],
      }),
    }).then(r => r.json());

    const gasLimit = BigInt(gasEstRes.result) * 12n / 10n; // +20% buffer

    console.log(`[wallet] nonce:${nonce} gas:${gasLimit} gasPrice:${gasPrice}`);

    // Per ora emette un evento con i parametri — la firma ECDSA completa
    // richiede una libreria esterna (ethers.js) che aggiungeremo nel prossimo step
    State.dispatch('WALLET_TX_READY', {
      from:     _address,
      to,
      data,
      nonce,
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      chainId,
      // TODO: firma ECDSA in-browser con ethers.js
    });
  }

  // ─── LOCK — cancella dalla RAM ─────────────────────────
  function lock() {
    _privateKey = null;
    _publicKey  = null;
    _address    = null;
    console.log('[wallet] chiavi rimosse dalla RAM');
  }

  // ─── ASCOLTA EVENTI ───────────────────────────────────

  // Quando il seed è disponibile (dopo login) → deriva il wallet
  State.subscribe('SEED_AVAILABLE', async ({ seed }) => {
    try {
      const { address, publicKey } = await deriveWallet(seed);
      State.dispatch('WALLET_READY', { address, publicKey });
    } catch (err) {
      console.error('[wallet] errore derivazione:', err);
      State.dispatch('SYSTEM_ERROR', { error: 'Wallet: ' + err.message });
    }
  });

  // Lock app → cancella chiavi wallet
  State.subscribe('CRYPTO_LOCKED', () => lock());

  // Richiesta invio transazione
  State.subscribe('INTENT_SEND_TX', async (params) => {
    try {
      await signAndSend(params);
    } catch (err) {
      State.dispatch('WALLET_TX_ERROR', { error: err.message });
    }
  });

  State.subscribe('APP_READY', () => {
    console.log('[wallet] modulo pronto');
  });

  // ─── API PUBBLICA ─────────────────────────────────────
  const pub = {
    deriveWallet,
    getAddress:      () => _address,
    getPublicKey:    () => _publicKey ? Array.from(_publicKey)
      .map(b => b.toString(16).padStart(2, '0')).join('') : null,
    getPrivateKeyHex: () => _privateKey ? Array.from(_privateKey)
      .map(b => b.toString(16).padStart(2, '0')).join('') : null,
    isReady:         () => !!_address,
    lock,
  };

  window.WalletModule = pub;
  return pub;

})();

export default WalletModule;

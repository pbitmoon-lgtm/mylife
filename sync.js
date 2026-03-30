// ═══════════════════════════════════════════════════════
// My Life — sync.js v2.0
// Il Ponte verso il Web3.
//
// RETI SUPPORTATE:
//   - Remix VM locale (sviluppo)
//   - Arbitrum Sepolia (testnet)
//   - Arbitrum Nova (mainnet, futuro)
//
// CONTRATTO: MyLifeRegistry.sol
//   function register(bytes32 aliasHash, bytes pubKey)
//   function resolve(bytes32 aliasHash) → bytes
//   function isRegistered(bytes32 aliasHash) → bool
// ═══════════════════════════════════════════════════════

import State from './state.js';

const SyncModule = (() => {

  // ─── CONFIGURAZIONE RETI ──────────────────────────────
  const NETWORKS = {

    // Remix VM locale — per sviluppo e test senza ETH
    local: {
      rpc:             null, // usa il provider di Remix/MetaMask
      chainId:         1337,
      registryAddress: '0xd9145CCE52D386f254917e481eB44e9943F39138',
      explorerBase:    null,
      label:           'Remix VM (locale)',
    },

    // Arbitrum Sepolia — testnet pubblica
    sepolia: {
      rpc:             'https://sepolia-rollup.arbitrum.io/rpc',
      chainId:         421614,
      registryAddress: '0x0000000000000000000000000000000000000000', // TODO: deploy
      explorerBase:    'https://sepolia.arbiscan.io',
      label:           'Arbitrum Sepolia',
    },

    // Arbitrum Nova — mainnet consumer (obiettivo finale)
    nova: {
      rpc:             'https://nova.arbitrum.io/rpc',
      chainId:         42170,
      registryAddress: '0x0000000000000000000000000000000000000000', // TODO: deploy
      explorerBase:    'https://nova.arbiscan.io',
      label:           'Arbitrum Nova',
    },
  };

  // Rete attiva — cambia in 'sepolia' o 'nova' quando deployi lì
  let _activeNetwork = 'local';
  const CONFIG = () => NETWORKS[_activeNetwork];

  // ─── STATO INTERNO ────────────────────────────────────
  let _syncing  = false;
  let _myAlias  = null;
  let _myPubKey = null;

  // ─── UTILITY CRITTOGRAFICHE ───────────────────────────

  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return '0x' + Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function derivePublicKey(seed) {
    const km = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey']);
    const derived = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife:arbitrum:v1'),
        info: new TextEncoder().encode('public_key') },
      km,
      { name: 'AES-GCM', length: 256 }, true, ['encrypt']
    );
    const raw = await crypto.subtle.exportKey('raw', derived);
    return '0x' + Array.from(new Uint8Array(raw))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── PROVIDER (MetaMask o RPC diretto) ────────────────

  async function _getProvider() {
    // Usa MetaMask se disponibile
    if (window.ethereum) return window.ethereum;
    // Fallback: RPC diretto (read-only)
    if (CONFIG().rpc) return null; // gestito in _ethCall
    throw new Error('Nessun provider disponibile. Installa MetaMask.');
  }

  async function _sendTransaction(calldata) {
    const provider = await _getProvider();
    if (!provider) throw new Error('MetaMask non disponibile');

    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const from = accounts[0];

    // Verifica rete corretta
    const chainIdHex = await provider.request({ method: 'eth_chainId' });
    const chainId = parseInt(chainIdHex, 16);
    if (chainId !== CONFIG().chainId) {
      throw new Error(
        `Rete sbagliata. Seleziona "${CONFIG().label}" in MetaMask (chainId: ${CONFIG().chainId})`
      );
    }

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: CONFIG().registryAddress, data: calldata }],
    });

    return txHash;
  }

  async function _ethCall(calldata) {
    // Usa MetaMask se disponibile, altrimenti RPC diretto
    if (window.ethereum) {
      const result = await window.ethereum.request({
        method: 'eth_call',
        params: [{ to: CONFIG().registryAddress, data: calldata }, 'latest'],
      });
      return result;
    }

    // Fallback RPC diretto
    if (!CONFIG().rpc) throw new Error('Nessun RPC configurato');
    const res = await fetch(CONFIG().rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: CONFIG().registryAddress, data: calldata }, 'latest'],
      }),
    });
    const { result, error } = await res.json();
    if (error) throw new Error(error.message);
    return result;
  }

  async function _waitConfirmation(txHash, maxAttempts = 20) {
    const rpc = CONFIG().rpc || 'http://localhost:8545';
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        let result;
        if (window.ethereum) {
          result = await window.ethereum.request({
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          });
        } else {
          const res = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1,
              method: 'eth_getTransactionReceipt',
              params: [txHash],
            }),
          });
          result = (await res.json()).result;
        }
        if (result?.status === '0x1') return true;
        if (result?.status === '0x0') return false;
      } catch { /* continua polling */ }
    }
    return false;
  }

  // ─── ABI ENCODING ─────────────────────────────────────

  function _encodeRegister(aliasHash, pubKey) {
    const sel    = 'a0e67e37';
    const hash32 = aliasHash.replace('0x', '').padStart(64, '0');
    const offset = '0000000000000000000000000000000000000000000000000000000000000040';
    const pkHex  = pubKey.replace('0x', '');
    const pkLen  = (pkHex.length / 2).toString(16).padStart(64, '0');
    const pkPad  = pkHex.padEnd(Math.ceil(pkHex.length / 64) * 64, '0');
    return `0x${sel}${hash32}${offset}${pkLen}${pkPad}`;
  }

  function _encodeResolve(aliasHash) {
    return `0x1687df0e${aliasHash.replace('0x', '').padStart(64, '0')}`;
  }

  function _encodeIsRegistered(aliasHash) {
    return `0x8c2e5f8a${aliasHash.replace('0x', '').padStart(64, '0')}`;
  }

  function _decodePubKey(hex) {
    if (!hex || hex === '0x') return null;
    const data   = hex.replace('0x', '');
    const offset = parseInt(data.slice(0, 64), 16) * 2;
    const length = parseInt(data.slice(offset, offset + 64), 16) * 2;
    return '0x' + data.slice(offset + 64, offset + 64 + length);
  }

  // ─── API PRINCIPALE ───────────────────────────────────

  async function registerAlias(alias, pubKey) {
    if (!alias || !pubKey) {
      State.dispatch('SYNC_REG_ERROR', { error: 'alias e pubKey obbligatori' });
      return false;
    }

    State.dispatch('SYNC_REG_START', { alias });
    try {
      const aliasHash = await sha256hex(alias.toLowerCase().trim());

      const taken = await isAliasRegistered(aliasHash);
      if (taken) {
        State.dispatch('SYNC_REG_ERROR', {
          error: `@${alias} è già registrato. Scegli un altro alias.`
        });
        return false;
      }

      const calldata = _encodeRegister(aliasHash, pubKey);
      const txHash   = await _sendTransaction(calldata);

      console.log(`[sync] tx inviata: ${txHash}`);
      State.dispatch('SYNC_REG_TX_SENT', { txHash });

      const confirmed = await _waitConfirmation(txHash);
      if (!confirmed) {
        State.dispatch('SYNC_REG_ERROR', { error: 'Timeout conferma transazione' });
        return false;
      }

      _myAlias  = alias;
      _myPubKey = pubKey;

      const explorerUrl = CONFIG().explorerBase
        ? `${CONFIG().explorerBase}/tx/${txHash}`
        : null;

      State.dispatch('SYNC_REG_COMPLETE', { alias, aliasHash, txHash, explorerUrl });
      return true;

    } catch (err) {
      console.error('[sync] errore registrazione:', err);
      State.dispatch('SYNC_REG_ERROR', { error: err.message });
      return false;
    }
  }

  async function resolveAlias(alias) {
    try {
      const aliasHash = await sha256hex(alias.toLowerCase().trim());
      const calldata  = _encodeResolve(aliasHash);
      const result    = await _ethCall(calldata);

      if (!result || result === '0x') {
        State.dispatch('SYNC_LOOKUP_NOT_FOUND', { alias });
        return null;
      }

      const pubKey = _decodePubKey(result);
      State.dispatch('SYNC_LOOKUP_FOUND', { alias, pubKey });
      return pubKey;

    } catch (err) {
      State.dispatch('SYNC_LOOKUP_ERROR', { alias, error: err.message });
      return null;
    }
  }

  async function isAliasRegistered(aliasHash) {
    try {
      const calldata = _encodeIsRegistered(aliasHash);
      const result   = await _ethCall(calldata);
      return result === '0x0000000000000000000000000000000000000000000000000000000000000001';
    } catch {
      return false;
    }
  }

  // ─── ARWEAVE ──────────────────────────────────────────

  async function anchorBackup(encFileBuffer) {
    State.dispatch('SYNC_ARWEAVE_START');
    try {
      const sizeKB = encFileBuffer.byteLength / 1024;
      if (sizeKB > 100) {
        State.dispatch('SYNC_ARWEAVE_BUNDLR_REQUIRED', {
          sizeKB: Math.round(sizeKB),
          message: 'File troppo grande per upload gratuito.',
        });
        return null;
      }

      const res = await fetch('https://arweave.net/tx', {
        method: 'POST',
        headers: {
          'Content-Type':   'application/octet-stream',
          'X-App-Name':     'MyLife',
        },
        body: encFileBuffer,
      });

      if (!res.ok) throw new Error(`Arweave HTTP ${res.status}`);
      const { id } = await res.json();
      const url = `https://arweave.net/${id}`;

      State.dispatch('SYNC_ARWEAVE_COMPLETE', {
        txId: id, url, sizeKB: Math.round(sizeKB), permanent: true,
      });
      return { txId: id, url };

    } catch (err) {
      State.dispatch('SYNC_ARWEAVE_ERROR', { error: err.message });
      return null;
    }
  }

  // ─── CAMBIO RETE ──────────────────────────────────────

  function setNetwork(name) {
    if (!NETWORKS[name]) {
      console.error('[sync] rete non trovata:', name);
      return;
    }
    _activeNetwork = name;
    console.log(`[sync] rete attiva: ${CONFIG().label}`);
    State.dispatch('SYNC_NETWORK_CHANGED', {
      network: name,
      label:   CONFIG().label,
      chainId: CONFIG().chainId,
    });
  }

  // ─── ASCOLTA EVENTI ───────────────────────────────────

  State.subscribe('INTENT_ANCHOR_BACKUP',   async ({ fileBuffer }) => { if (fileBuffer) await anchorBackup(fileBuffer); });
  State.subscribe('INTENT_REGISTER_ALIAS',  async ({ alias, pubKey }) => {
    if (_syncing) { State.dispatch('SYNC_REG_ERROR', { error: 'Operazione già in corso' }); return; }
    _syncing = true;
    await registerAlias(alias, pubKey);
    _syncing = false;
  });
  State.subscribe('INTENT_RESOLVE_ALIAS',   async ({ alias }) => { await resolveAlias(alias); });
  State.subscribe('INTENT_SET_NETWORK',     ({ network }) => { setNetwork(network); });
  State.subscribe('APP_READY', () => {
    console.log(`[sync] pronto — rete: ${CONFIG().label} (${CONFIG().chainId})`);
  });

  // ─── API PUBBLICA ─────────────────────────────────────
  const pub = {
    anchorBackup, registerAlias, resolveAlias,
    isAliasRegistered, derivePublicKey, sha256hex,
    setNetwork,
    getNetwork:  () => _activeNetwork,
    getMyAlias:  () => _myAlias,
    getMyPubKey: () => _myPubKey,
    networks:    NETWORKS,
  };

  window.SyncModule = pub;
  return pub;

})();

export default SyncModule;

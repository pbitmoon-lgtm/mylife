// ═══════════════════════════════════════════════════════
// My Life — sync.js  v1.0
// Il Ponte verso il Web3.
//
// RESPONSABILITÀ:
//   1. Arweave  — ancora il backup .enc su storage permanente
//   2. Arbitrum — registra alias → chiave pubblica (rubrica cieca)
//   3. Paymaster — paga il gas per l'utente (UX Web2-like)
//   4. Lookup   — risolve alias → chiave pubblica per la chat
//
// CONTRATTO ATTESO SU ARBITRUM (MyLifeRegistry.sol):
//   function register(bytes32 aliasHash, bytes pubKey) external
//   function resolve(bytes32 aliasHash) view returns (bytes)
//   function isRegistered(bytes32 aliasHash) view returns (bool)
//
// PAYMASTER: nodo che paga il gas per l'utente.
//   L'utente non ha ETH — il Paymaster sponsorizza la tx.
//   Costo stimato: ~$0.0001 per registrazione.
//
// TUTTO è asincrono e non blocca mai la UI.
// Comunica solo tramite State.dispatch().
// ═══════════════════════════════════════════════════════

import State from './state.js';

const SyncModule = (() => {

  // ─── CONFIGURAZIONE ───────────────────────────────────
  // TODO: sostituire con indirizzi reali al deploy
  const CONFIG = {
    // Arbitrum One (mainnet) o Sepolia (testnet)
    arbitrum: {
      rpc:             'https://arb1.arbitrum.io/rpc',
      chainId:         42161,
      registryAddress: '0x0000000000000000000000000000000000000000', // TODO: deploy
      paymasterUrl:    'https://paymaster.mylife.app/v1',            // TODO: deploy
    },
    arweave: {
      gateway: 'https://arweave.net',
      // Upload via Bundlr/Irys (paga in ETH su Arbitrum, salva su Arweave)
      bundlrNode: 'https://node2.irys.xyz',
    },
  };

  // ABI minimo del contratto MyLifeRegistry
  const REGISTRY_ABI = [
    // register(bytes32 aliasHash, bytes pubKey)
    '0x' + 'a0e67e37', // selector: register(bytes32,bytes)
    // resolve(bytes32 aliasHash) → bytes
    '0x' + '1687df0e', // selector: resolve(bytes32)
    // isRegistered(bytes32 aliasHash) → bool
    '0x' + '8c2e5f8a', // selector: isRegistered(bytes32)
  ];

  // ─── STATO INTERNO ────────────────────────────────────
  let _syncing    = false;
  let _myAlias    = null;
  let _myPubKey   = null;

  // ─── UTILITY CRITTOGRAFICHE ───────────────────────────

  // SHA-256 di una stringa → bytes32 hex
  async function sha256hex(str) {
    const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return '0x' + Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // Deriva la chiave pubblica Arbitrum dal seed dell'utente
  // Usa HKDF per derivare un keypair secp256k1-compatible
  // In M4 useremo ethers.js — per ora placeholder strutturato
  async function derivePublicKey(seed) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', seed, 'HKDF', false, ['deriveKey']
    );
    const derived = await crypto.subtle.deriveKey(
      {
        name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('MyLife:arbitrum:v1'),
        info: new TextEncoder().encode('public_key'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 }, // placeholder — in M4 sarà secp256k1
      true,
      ['encrypt']
    );
    const raw = await crypto.subtle.exportKey('raw', derived);
    return '0x' + Array.from(new Uint8Array(raw))
      .map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ─── 1. ARWEAVE BACKUP ANCHORING ──────────────────────
  // Carica il file .enc su Arweave tramite Irys (Bundlr).
  // Costo: ~€0.005 per file, permanente per sempre.
  // L'utente paga in ETH su Arbitrum (non serve Arweave token).

  async function anchorBackup(encFileBuffer) {
    State.dispatch('SYNC_ARWEAVE_START');
    try {
      // Verifica dimensione (Arweave gratuito fino a 100KB)
      const sizeKB = encFileBuffer.byteLength / 1024;
      if (sizeKB > 100) {
        // Oltre 100KB → usa Bundlr (a pagamento)
        return await _uploadViaBundlr(encFileBuffer);
      } else {
        // Sotto 100KB → upload gratuito diretto
        return await _uploadFreeArweave(encFileBuffer);
      }
    } catch (err) {
      console.error('[sync:arweave] errore upload:', err);
      State.dispatch('SYNC_ARWEAVE_ERROR', { error: err.message });
      return null;
    }
  }

  async function _uploadFreeArweave(buffer) {
    // Arweave accetta upload gratuiti sotto 100KB tramite gateway
    const res = await fetch(`${CONFIG.arweave.gateway}/tx`, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/octet-stream',
        'X-App-Name':     'MyLife',
        'X-Content-Type': 'application/octet-stream',
      },
      body: buffer,
    });

    if (!res.ok) throw new Error(`Arweave HTTP ${res.status}`);
    const { id } = await res.json();
    const arweaveUrl = `${CONFIG.arweave.gateway}/${id}`;

    console.log('[sync:arweave] ✅ anchored:', arweaveUrl);
    State.dispatch('SYNC_ARWEAVE_COMPLETE', {
      txId:       id,
      url:        arweaveUrl,
      sizeKB:     Math.round(buffer.byteLength / 1024),
      permanent:  true,
    });
    return { txId: id, url: arweaveUrl };
  }

  async function _uploadViaBundlr(buffer) {
    // Irys (ex Bundlr): upload pagato in ETH su Arbitrum
    // Richiede firma della transazione con la chiave dell'utente
    // TODO M3: integrazione completa con ethers.js
    console.log('[sync:arweave] file >100KB → Bundlr required (M3)');
    State.dispatch('SYNC_ARWEAVE_BUNDLR_REQUIRED', {
      sizeKB: Math.round(buffer.byteLength / 1024),
      message: 'File troppo grande per upload gratuito. Richiede wallet ETH.',
    });
    return null;
  }

  // ─── 2. ARBITRUM — REGISTRAZIONE ALIAS ────────────────
  // Registra l'alias dell'utente nella rubrica cieca on-chain.
  // L'alias viene hashato (SHA-256) prima di inviarlo — nessuno
  // può risalire al nome originale dall'hash on-chain.
  // Il Paymaster paga il gas — l'utente non ha bisogno di ETH.

  async function registerAlias(alias, pubKey) {
    if (!alias || !pubKey) {
      State.dispatch('SYNC_REG_ERROR', { error: 'alias e pubKey obbligatori' });
      return false;
    }

    State.dispatch('SYNC_REG_START', { alias });
    try {
      const aliasHash = await sha256hex(alias.toLowerCase().trim());

      // Prima verifica: l'alias è già registrato?
      const taken = await isAliasRegistered(aliasHash);
      if (taken) {
        State.dispatch('SYNC_REG_ERROR', {
          error: `@${alias} è già registrato. Scegli un altro alias.`
        });
        return false;
      }

      // Costruisce la chiamata al contratto
      const calldata = _encodeRegister(aliasHash, pubKey);

      // Invia al Paymaster — lui costruisce e paga la tx su Arbitrum
      const txHash = await _sendViaPaymaster(calldata);
      if (!txHash) return false;

      // Attendi conferma
      const confirmed = await _waitConfirmation(txHash);
      if (!confirmed) {
        State.dispatch('SYNC_REG_ERROR', { error: 'Timeout conferma transazione' });
        return false;
      }

      _myAlias  = alias;
      _myPubKey = pubKey;

      console.log(`[sync:arbitrum] ✅ @${alias} registrato — tx: ${txHash}`);
      State.dispatch('SYNC_REG_COMPLETE', {
        alias, aliasHash, txHash,
        explorerUrl: `https://arbiscan.io/tx/${txHash}`,
      });
      return true;

    } catch (err) {
      console.error('[sync:arbitrum] errore registrazione:', err);
      State.dispatch('SYNC_REG_ERROR', { error: err.message });
      return false;
    }
  }

  // ─── 3. ARBITRUM — LOOKUP ALIAS ───────────────────────
  // Risolve un alias (@mario) nella sua chiave pubblica.
  // Usato dalla chat per instaurare il canale cifrato P2P.

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
      console.error('[sync:arbitrum] errore lookup:', err);
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
      return false; // In caso di errore RPC, assume non registrato
    }
  }

  // ─── 4. PAYMASTER — SPONSORIZZA IL GAS ────────────────
  // Invia la calldata al nostro Paymaster.
  // Il Paymaster verifica che sia una chiamata valida al nostro
  // contratto, poi costruisce e firma la tx UserOperation (ERC-4337)
  // pagando il gas di tasca propria.

  async function _sendViaPaymaster(calldata) {
    try {
      const res = await fetch(`${CONFIG.paymaster}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:       CONFIG.arbitrum.registryAddress,
          calldata,
          chainId:  CONFIG.arbitrum.chainId,
          appId:    'mylife-v1', // identifica l'app al Paymaster
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Paymaster HTTP ${res.status}`);
      }

      const { txHash } = await res.json();
      console.log('[sync:paymaster] tx inviata:', txHash);
      return txHash;

    } catch (err) {
      // Paymaster non disponibile → fallback: chiedi all'utente di pagare
      if (err.message.includes('fetch') || err.message.includes('network')) {
        State.dispatch('SYNC_PAYMASTER_OFFLINE', {
          message: 'Servizio Paymaster non disponibile. Riprova più tardi.',
        });
      }
      throw err;
    }
  }

  // ─── 5. RPC ARBITRUM — LETTURA ON-CHAIN ───────────────
  async function _ethCall(calldata) {
    const res = await fetch(CONFIG.arbitrum.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{
          to:   CONFIG.arbitrum.registryAddress,
          data: calldata,
        }, 'latest'],
      }),
    });
    const { result, error } = await res.json();
    if (error) throw new Error(error.message);
    return result;
  }

  async function _waitConfirmation(txHash, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000)); // attende 3s tra tentativi
      try {
        const res = await fetch(CONFIG.arbitrum.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method:  'eth_getTransactionReceipt',
            params:  [txHash],
          }),
        });
        const { result } = await res.json();
        if (result && result.status === '0x1') return true;  // confermata
        if (result && result.status === '0x0') return false; // fallita
      } catch { /* continua il polling */ }
    }
    return false; // timeout
  }

  // ─── ABI ENCODING (minimal, senza ethers.js) ──────────
  // Encoding manuale delle chiamate al contratto.
  // In M4 verrà sostituito con ethers.js/viem.

  function _encodeRegister(aliasHash, pubKey) {
    // register(bytes32 aliasHash, bytes pubKey)
    // selector: keccak256("register(bytes32,bytes)")[0:4]
    const sel    = 'a0e67e37';
    const hash32 = aliasHash.replace('0x','').padStart(64,'0');
    const offset = '0000000000000000000000000000000000000000000000000000000000000040';
    const pkHex  = pubKey.replace('0x','');
    const pkLen  = (pkHex.length / 2).toString(16).padStart(64,'0');
    const pkPad  = pkHex.padEnd(Math.ceil(pkHex.length/64)*64,'0');
    return `0x${sel}${hash32}${offset}${pkLen}${pkPad}`;
  }

  function _encodeResolve(aliasHash) {
    // resolve(bytes32 aliasHash)
    const sel    = '1687df0e';
    const hash32 = aliasHash.replace('0x','').padStart(64,'0');
    return `0x${sel}${hash32}`;
  }

  function _encodeIsRegistered(aliasHash) {
    // isRegistered(bytes32 aliasHash)
    const sel    = '8c2e5f8a';
    const hash32 = aliasHash.replace('0x','').padStart(64,'0');
    return `0x${sel}${hash32}`;
  }

  function _decodePubKey(hex) {
    // Decodifica la risposta bytes dal contratto
    if (!hex || hex === '0x') return null;
    const data   = hex.replace('0x','');
    const offset = parseInt(data.slice(0,64), 16) * 2;
    const length = parseInt(data.slice(offset, offset+64), 16) * 2;
    return '0x' + data.slice(offset+64, offset+64+length);
  }

  // ─── ASCOLTA EVENTI DELL'APP ──────────────────────────

  // Quando il backup è completo → offri di ancorarlo su Arweave
  State.subscribe('BACKUP_COMPLETE', ({ filename }) => {
    console.log(`[sync] backup ${filename} pronto — Arweave anchor disponibile`);
    State.dispatch('SYNC_BACKUP_READY', { filename });
  });

  // Quando l'utente vuole ancorare su Arweave
  State.subscribe('INTENT_ANCHOR_BACKUP', async ({ fileBuffer }) => {
    if (!fileBuffer) return;
    await anchorBackup(fileBuffer);
  });

  // Quando l'utente vuole registrare il suo alias
  State.subscribe('INTENT_REGISTER_ALIAS', async ({ alias, pubKey }) => {
    if (_syncing) {
      State.dispatch('SYNC_REG_ERROR', { error: 'Operazione già in corso' });
      return;
    }
    _syncing = true;
    await registerAlias(alias, pubKey);
    _syncing = false;
  });

  // Quando la chat cerca un utente per alias
  State.subscribe('INTENT_RESOLVE_ALIAS', async ({ alias }) => {
    await resolveAlias(alias);
  });

  State.subscribe('APP_READY', () => {
    console.log('[sync] modulo pronto — Arbitrum:', CONFIG.arbitrum.rpc);
  });

  // ─── API PUBBLICA ──────────────────────────────────────
  const pub = {
    anchorBackup,
    registerAlias,
    resolveAlias,
    isAliasRegistered,
    derivePublicKey,
    sha256hex,
    // Stato
    getMyAlias:  () => _myAlias,
    getMyPubKey: () => _myPubKey,
  };
  window.SyncModule = pub;
  return pub;

})();

export default SyncModule;
